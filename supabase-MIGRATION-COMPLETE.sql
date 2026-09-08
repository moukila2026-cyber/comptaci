-- ============================================================================
-- COMPTACI — MIGRATION COMPLÈTE (à coller EN UNE SEULE FOIS dans le SQL Editor)
-- ----------------------------------------------------------------------------
-- Ce fichier enchaîne les 5 migrations, dans l'ordre, avec leurs séparateurs :
--   1. supabase-types-etablissements.sql   (essai 14 jours, 10 types, poste_id)
--   2. supabase-fne.sql                    (factures normalisées)
--   3. supabase-score-credit.sql           (historique du score de crédit)
--   4. supabase-paiements.sql              (demandes de paiement)
--   5. supabase-saspay-webhook.sql         (webhook SasPay + activation auto)
--
-- Toutes sont IDEMPOTENTES : tu peux relancer ce script sans risque (aucune
-- donnée n'est supprimée, les tables/colonnes déjà créées sont ignorées).
--
-- Où : Supabase → ton projet → SQL Editor → New query → coller → Run
-- ============================================================================



-- ==========================================================================
-- 1) supabase-types-etablissements.sql
-- ==========================================================================

-- ============================================================================
--  ComptaCi — Types d'établissement élargis + essai gratuit de 14 jours
--  À exécuter dans Supabase → SQL Editor (sans supprimer aucune donnée).
--
--  1. essai gratuit : 7 jours -> 14 jours pour tous les nouveaux comptes
--  2. secteur : 4 valeurs -> 10 types d'établissement (restaurant, bar,
--     maquis, hôtel, quincaillerie, boutique, salon de coiffure et beauté,
--     boutique d'accessoires de téléphone, boutique de vêtements, pharmacie)
--  3. conversion automatique des anciennes valeurs (restauration -> restaurant)
--  4. colonne poste_id sur les transactions (rattachement d'une dépense à son
--     poste réel : « biscuits », « eau de javel », « faux ongles »…)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Essai gratuit de 14 jours
-- ---------------------------------------------------------------------------
alter table etablissements
  alter column essai_jours set default 14;

-- Les essais déjà en cours passent de 7 à 14 jours : on allonge la période en
-- cours sans jamais la raccourcir (greatest = garde-fou).
update etablissements
   set essai_jours = 14
 where essai_jours is null
    or essai_jours < 14;

-- ---------------------------------------------------------------------------
-- 2. Élargissement de la liste des types d'établissement
-- ---------------------------------------------------------------------------
alter table etablissements drop constraint if exists etablissements_secteur_check;

-- Requalifie les anciennes valeurs avant de poser la nouvelle contrainte.
update etablissements set secteur = 'restaurant'   where secteur = 'restauration';
update etablissements set secteur = 'boutique'     where secteur in ('alimentation', 'superette', 'epicerie');
update etablissements set secteur = 'salon_beaute' where secteur in ('coiffure', 'salon', 'beaute');
update etablissements set secteur = 'accessoires_telephone'
  where secteur in ('telephone', 'accessoires');
update etablissements set secteur = 'vetements'    where secteur = 'habillement';
update etablissements set secteur = 'restaurant'   where secteur is null;

-- Filet de sécurité : toute valeur inconnue est ramenée à 'restaurant' pour que
-- la contrainte puisse être posée même sur une base contenant des résidus.
update etablissements
   set secteur = 'restaurant'
 where secteur not in (
   'restaurant', 'bar', 'maquis', 'hotel', 'quincaillerie',
   'boutique', 'salon_beaute', 'accessoires_telephone', 'vetements', 'pharmacie'
 );

alter table etablissements
  add constraint etablissements_secteur_check
  check (secteur in (
    'restaurant',            -- Restaurant
    'bar',                   -- Bar
    'maquis',                -- Maquis
    'hotel',                 -- Hôtel
    'quincaillerie',         -- Quincaillerie
    'boutique',              -- Boutique (épicerie / supérette)
    'salon_beaute',          -- Salon de coiffure et beauté
    'accessoires_telephone', -- Boutique d'accessoires de téléphone
    'vetements',             -- Boutique de vêtements
    'pharmacie'              -- Pharmacie
  ));

-- ---------------------------------------------------------------------------
-- 3. Mise à jour de la fonction de création d'établissement
--    (recréée seulement si elle existe déjà)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'creer_etablissement'
  ) then
    execute '
      create or replace function public.creer_etablissement(p_nom text, p_secteur text default ''restaurant'')
      returns etablissements
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      declare
        v_secteur text;
        v_etab    etablissements;
      begin
        -- Le secteur demandé est validé : toute valeur inconnue tombe sur le
        -- type par défaut au lieu de faire échouer l''inscription.
        if p_secteur in (
          ''restaurant'', ''bar'', ''maquis'', ''hotel'', ''quincaillerie'',
          ''boutique'', ''salon_beaute'', ''accessoires_telephone'', ''vetements'', ''pharmacie''
        ) then
          v_secteur := p_secteur;
        elsif p_secteur = ''restauration'' then
          v_secteur := ''restaurant'';
        elsif p_secteur in (''alimentation'', ''superette'', ''epicerie'') then
          v_secteur := ''boutique'';
        elsif p_secteur in (''coiffure'', ''salon'', ''beaute'') then
          v_secteur := ''salon_beaute'';
        elsif p_secteur in (''telephone'', ''accessoires'') then
          v_secteur := ''accessoires_telephone'';
        elsif p_secteur = ''habillement'' then
          v_secteur := ''vetements'';
        else
          v_secteur := ''restaurant'';
        end if;

        insert into etablissements (nom, secteur, proprietaire_id)
        values (p_nom, v_secteur, auth.uid())
        returning * into v_etab;

        insert into membres (etablissement_id, user_id, role)
        values (v_etab.id, auth.uid(), ''proprietaire'');

        return v_etab;
      end;
      $fn$;
    ';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Offre fondateurs : 14 jours (au lieu de 7) + 0 FCFA pendant l'essai
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'appliquer_offre_fondateur'
  ) then
    execute '
      create or replace function public.appliquer_offre_fondateur()
      returns trigger
      language plpgsql
      as $fn$
      declare
        compte_fondateurs int;
      begin
        select count(*) into compte_fondateurs from etablissements where est_fondateur = true;
        -- 14 jours d''essai gratuit (0 FCFA) pour tout le monde.
        new.essai_jours := 14;
        if compte_fondateurs < 100 then
          new.est_fondateur := true;
          new.tarif_verrouille := 7000;
        else
          new.est_fondateur := false;
          new.tarif_verrouille := null;
        end if;
        return new;
      end;
      $fn$;
    ';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rattachement d'une dépense à son poste réel (répartition du tableau de bord)
-- ---------------------------------------------------------------------------
alter table transactions add column if not exists poste_id text;

create index if not exists transactions_poste_id_idx on transactions (poste_id);

comment on column transactions.poste_id is
  'Identifiant du poste de dépense du secteur (ex : biscuits, javel, faux_ongles). '
  'Sert à la répartition « dépenses réelles de votre activité ».';

-- ---------------------------------------------------------------------------
-- 6. Vérification
-- ---------------------------------------------------------------------------
-- select secteur, count(*) from etablissements group by secteur order by 2 desc;
-- select essai_jours, count(*) from etablissements group by essai_jours;


-- ==========================================================================
-- 2) supabase-fne.sql
-- ==========================================================================

-- ============================================================================
--  ComptaCi — Facture Normalisée Électronique (FNE / DGI Côte d'Ivoire)
--  À exécuter dans Supabase → SQL Editor (propriété non destructive).
--
--  • Colonnes d'enrôlement DGI sur `etablissements`
--  • Table `factures_fne` : archivage légal des factures (10 ans)
--  • RLS : un établissement ne voit et ne modifie que ses propres factures
--
--  ⚠️ Rappel : l'enrôlement auprès de la DGI (numéro de contribuable, RCCM,
--  clé API) est une démarche administrative que le CLIENT doit accomplir.
--  ComptaCi ne peut pas s'y substituer. Sans clé API, les factures générées
--  sont des BROUILLONS archivés (numéro provisoire, non certifiés).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enrôlement DGI de l'établissement
-- ---------------------------------------------------------------------------
alter table etablissements
  add column if not exists fne_numero_contribuable text;

alter table etablissements
  add column if not exists fne_rccm text;

alter table etablissements
  add column if not exists fne_cle_api text;

alter table etablissements
  add column if not exists fne_active boolean not null default false;

comment on column etablissements.fne_numero_contribuable is
  'Numéro de contribuable DGI (obligatoire pour la facture normalisée).';
comment on column etablissements.fne_rccm is
  'Registre du Commerce et du Crédit Mobilier.';
comment on column etablissements.fne_cle_api is
  'Clé API fournie par la DGI après enrôlement sur la plateforme FNE.';

-- ---------------------------------------------------------------------------
-- 2. Archivage des factures normalisées (conservation légale 10 ans)
-- ---------------------------------------------------------------------------
create table if not exists factures_fne (
  id                  uuid primary key default gen_random_uuid(),
  etablissement_id    uuid not null references etablissements (id) on delete cascade,
  transaction_id      uuid references transactions (id) on delete set null,
  numero              text not null,
  statut              text not null default 'brouillon'
                        check (statut in ('brouillon', 'certifiee', 'refusee')),
  date_emission       date not null default current_date,
  montant_ht          numeric(14, 2) not null default 0,
  tva                 numeric(14, 2) not null default 0,
  montant_ttc         numeric(14, 2) not null default 0,
  lignes              jsonb not null default '[]'::jsonb,
  reponse_dgi         jsonb,
  erreur_dgi          text,
  conserve_jusqua     date,
  created_at          timestamptz not null default now()
);

create index if not exists factures_fne_etablissement_idx
  on factures_fne (etablissement_id, date_emission desc);

create index if not exists factures_fne_numero_idx
  on factures_fne (numero);

comment on table factures_fne is
  'Factures normalisées (FNE) générées depuis ComptaCi. Archivage légal : 10 ans.';

-- ---------------------------------------------------------------------------
-- 3. Sécurité RLS : chaque établissement n'accède qu'à ses factures
-- ---------------------------------------------------------------------------
alter table factures_fne enable row level security;

drop policy if exists "factures_fne_visibles_par_membres" on factures_fne;
create policy "factures_fne_visibles_par_membres"
  on factures_fne for select
  using (
    exists (
      select 1
        from membres m
       where m.etablissement_id = factures_fne.etablissement_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists "factures_fne_insertion_par_membres" on factures_fne;
create policy "factures_fne_insertion_par_membres"
  on factures_fne for insert
  with check (
    exists (
      select 1
        from membres m
       where m.etablissement_id = factures_fne.etablissement_id
         and m.user_id = auth.uid()
    )
  );

-- Une facture archivée n'est jamais modifiée ni supprimée depuis l'application :
-- c'est une pièce comptable. Aucune politique UPDATE / DELETE n'est donc créée.
-- (Un administrateur Supabase peut toujours intervenir manuellement si besoin.)

-- ---------------------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------------------
-- select statut, count(*) from factures_fne group by statut;
-- select numero, montant_ttc, conserve_jusqua from factures_fne order by date_emission desc limit 20;


-- ==========================================================================
-- 3) supabase-score-credit.sql
-- ==========================================================================

-- ============================================================================
--  ComptaCi — Score de crédit : historique (crédibilité auprès d'une banque)
--  À exécuter dans Supabase → SQL Editor (propriété non destructive).
--
--  Un score ponctuel prouve peu ; une PROGRESSION sur plusieurs mois prouve
--  une gestion sérieuse. On enregistre donc un point d'historique par
--  établissement et par mois (un seul point par mois, mise à jour ensuite).
-- ============================================================================

create table if not exists scores_credit (
  id                uuid primary key default gen_random_uuid(),
  etablissement_id  uuid not null references etablissements (id) on delete cascade,
  -- Clé de mois « AAAA-MM » : un seul point d'historique par mois.
  periode           char(7) not null,
  score             smallint not null check (score between 0 and 100),
  palier            text not null check (palier in ('bronze', 'argent', 'or')),
  objectifs_atteints smallint not null default 0,
  objectifs_total   smallint not null default 0,
  ca_90j            numeric(16, 2) not null default 0,
  depenses_90j      numeric(16, 2) not null default 0,
  regularite_pct    numeric(5, 2) not null default 0,
  anciennete_jours  integer not null default 0,
  detail            jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint scores_credit_etab_periode_key unique (etablissement_id, periode)
);

create index if not exists scores_credit_etab_idx
  on scores_credit (etablissement_id, periode desc);

comment on table scores_credit is
  'Historique mensuel du score de crédit ComptaCi (preuve de progression pour un prêteur).';

-- ---------------------------------------------------------------------------
-- Sécurité RLS : un établissement ne voit et n'écrit que son propre historique
-- ---------------------------------------------------------------------------
alter table scores_credit enable row level security;

drop policy if exists "scores_credit_lecture_membres" on scores_credit;
create policy "scores_credit_lecture_membres"
  on scores_credit for select
  using (
    exists (
      select 1
        from membres m
       where m.etablissement_id = scores_credit.etablissement_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists "scores_credit_ecriture_membres" on scores_credit;
create policy "scores_credit_ecriture_membres"
  on scores_credit for insert
  with check (
    exists (
      select 1
        from membres m
       where m.etablissement_id = scores_credit.etablissement_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists "scores_credit_maj_membres" on scores_credit;
create policy "scores_credit_maj_membres"
  on scores_credit for update
  using (
    exists (
      select 1
        from membres m
       where m.etablissement_id = scores_credit.etablissement_id
         and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
        from membres m
       where m.etablissement_id = scores_credit.etablissement_id
         and m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Enregistrement « upsert » du point du mois (idempotent, sûr côté RLS)
-- ---------------------------------------------------------------------------
create or replace function public.enregistrer_score_credit(
  p_etablissement_id uuid,
  p_periode          text,
  p_score            integer,
  p_palier           text,
  p_objectifs_atteints integer,
  p_objectifs_total  integer,
  p_ca_90j           numeric,
  p_depenses_90j     numeric,
  p_regularite_pct   numeric,
  p_anciennete_jours integer,
  p_detail           jsonb default '[]'::jsonb
)
returns scores_credit
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligne scores_credit;
begin
  -- On refuse d'écrire pour un établissement dont l'utilisateur n'est pas membre.
  if not exists (
    select 1 from membres m
     where m.etablissement_id = p_etablissement_id
       and m.user_id = auth.uid()
  ) then
    raise exception 'non autorise pour cet etablissement';
  end if;

  insert into scores_credit (
    etablissement_id, periode, score, palier,
    objectifs_atteints, objectifs_total,
    ca_90j, depenses_90j, regularite_pct, anciennete_jours, detail
  )
  values (
    p_etablissement_id, p_periode,
    least(100, greatest(0, p_score)), p_palier,
    p_objectifs_atteints, p_objectifs_total,
    coalesce(p_ca_90j, 0), coalesce(p_depenses_90j, 0),
    coalesce(p_regularite_pct, 0), coalesce(p_anciennete_jours, 0),
    coalesce(p_detail, '[]'::jsonb)
  )
  on conflict (etablissement_id, periode) do update
     set score             = excluded.score,
         palier            = excluded.palier,
         objectifs_atteints = excluded.objectifs_atteints,
         objectifs_total   = excluded.objectifs_total,
         ca_90j            = excluded.ca_90j,
         depenses_90j      = excluded.depenses_90j,
         regularite_pct    = excluded.regularite_pct,
         anciennete_jours  = excluded.anciennete_jours,
         detail            = excluded.detail,
         updated_at        = now()
  returning * into v_ligne;

  return v_ligne;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------------
-- select periode, score, palier, objectifs_atteints, ca_90j
--   from scores_credit order by periode desc limit 12;


-- ==========================================================================
-- 4) supabase-paiements.sql
-- ==========================================================================

-- ============================================================
-- COMPTACI — Migration paiements Wave uniquement
-- À utiliser si supabase-SETUP-FINAL.sql a déjà été exécuté
-- AVANT l'ajout de la section 14. Sinon, préfère SETUP-FINAL.
-- Idempotent.
-- ============================================================

-- 14) Table demandes_paiement + activation manuelle (admin)
-- ------------------------------------------------------------
-- Parcours client : scan QR Wave → « J'ai payé » → ligne en_attente.
-- L'admin ComptaCi valide dans Supabase (ou via RPC valider_paiement)
-- ce qui active abonnement_actif + plan sur l'établissement.
create table if not exists demandes_paiement (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  plan text not null check (plan in ('starter', 'pro', 'entreprise')),
  montant numeric not null,
  telephone_payeur text,
  reference_wave text,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'valide', 'refuse', 'annule')),
  note_admin text,
  cree_par uuid references auth.users,
  cree_le timestamp not null default now(),
  traite_le timestamp,
  traite_par uuid references auth.users
);

create index if not exists idx_demandes_paiement_etab
  on demandes_paiement (etablissement_id, statut, cree_le desc);

alter table demandes_paiement enable row level security;

drop policy if exists "membres_voient_demandes_paiement" on demandes_paiement;
create policy "membres_voient_demandes_paiement" on demandes_paiement
  for select using (public.est_membre_de(etablissement_id));

-- Seul le propriétaire (ou un membre) peut déclarer un paiement pour son établissement.
drop policy if exists "membres_creent_demandes_paiement" on demandes_paiement;
create policy "membres_creent_demandes_paiement" on demandes_paiement
  for insert with check (
    public.peut_ecrire_dans(etablissement_id)
    and (cree_par is null or cree_par = auth.uid())
  );

-- Pas d'UPDATE/delete côté client : seul le service_role (SQL Editor / dashboard)
-- ou la RPC admin ci-dessous peut changer le statut.

-- Renseigner automatiquement cree_par
create or replace function public.demandes_paiement_set_auteur()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.cree_par is null then
    new.cree_par := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_demandes_paiement_auteur on demandes_paiement;
create trigger trg_demandes_paiement_auteur
  before insert on demandes_paiement
  for each row execute function public.demandes_paiement_set_auteur();

-- RPC admin : valider une demande → active l'abonnement + pose le plan.
-- À appeler depuis le SQL Editor (service role) ou un futur back-office :
--   select public.valider_paiement('<uuid_demande>');
create or replace function public.valider_paiement(demande_id uuid, note text default null)
returns demandes_paiement
language plpgsql
security definer
set search_path = public
as $$
declare
  d demandes_paiement;
begin
  select * into d from demandes_paiement where id = demande_id for update;
  if not found then
    raise exception 'Demande de paiement introuvable.';
  end if;
  if d.statut = 'valide' then
    return d;
  end if;

  update etablissements
    set abonnement_actif = true,
        plan = d.plan
    where id = d.etablissement_id;

  update demandes_paiement
    set statut = 'valide',
        traite_le = now(),
        traite_par = auth.uid(),
        note_admin = coalesce(note, note_admin)
    where id = demande_id
    returning * into d;

  return d;
end;
$$;

-- Réservée au service_role / SQL Editor (pas exposée à anon/authenticated).
revoke all on function public.valider_paiement(uuid, text) from public, anon, authenticated;

-- RPC admin : refuser une demande (laisse l'accès bloqué).
create or replace function public.refuser_paiement(demande_id uuid, note text default null)
returns demandes_paiement
language plpgsql
security definer
set search_path = public
as $$
declare
  d demandes_paiement;
begin
  update demandes_paiement
    set statut = 'refuse',
        traite_le = now(),
        traite_par = auth.uid(),
        note_admin = coalesce(note, note_admin)
    where id = demande_id
    returning * into d;
  if not found then
    raise exception 'Demande de paiement introuvable.';
  end if;
  return d;
end;
$$;
revoke all on function public.refuser_paiement(uuid, text) from public, anon, authenticated;

-- Vue pratique pour l'admin (SQL Editor) : file d'attente des paiements.
create or replace view public.v_paiements_en_attente as
select
  d.id as demande_id,
  d.cree_le,
  d.plan,
  d.montant,
  d.telephone_payeur,
  d.reference_wave,
  d.statut,
  e.id as etablissement_id,
  e.nom as etablissement_nom,
  e.telephone as etablissement_telephone,
  e.plan as plan_actuel,
  e.abonnement_actif,
  e.est_fondateur
from demandes_paiement d
join etablissements e on e.id = d.etablissement_id
where d.statut = 'en_attente'
order by d.cree_le asc;


-- Admin — exemples :
--   select * from v_paiements_en_attente;
--   select public.valider_paiement('<uuid_demande>');
--   select public.refuser_paiement('<uuid_demande>', 'motif');


-- ==========================================================================
-- 5) supabase-saspay-webhook.sql
-- ==========================================================================

-- ============================================================
-- COMPTACI — Paiements SasPay : webhook + activation automatique
-- ------------------------------------------------------------
-- À exécuter dans Supabase → SQL Editor, APRES supabase-paiements.sql.
-- Idempotent.
--
-- Rôle de cette migration :
--   1. journalise chaque notification SasPay (table paiements_saspay) ;
--   2. active l'abonnement de l'établissement dès que le paiement est
--      confirmé (fonction traiter_paiement_saspay, appelée par l'Edge
--      Function supabase/functions/webhook-saspay) ;
--   3. clôture la demande manuelle correspondante (demandes_paiement).
-- ============================================================

-- 1) Journal des notifications SasPay
-- ------------------------------------------------------------
create table if not exists paiements_saspay (
  id uuid primary key default gen_random_uuid(),
  transaction_id text unique,
  reference text,
  etablissement_id uuid references etablissements on delete set null,
  plan text check (plan in ('starter', 'pro', 'entreprise')),
  montant numeric,
  devise text default 'XOF',
  telephone_payeur text,
  statut text not null default 'recu'
    check (statut in ('recu', 'valide', 'echoue', 'refuse', 'rembourse')),
  evenement text,
  signature_valide boolean not null default false,
  payload jsonb,
  erreur text,
  recu_le timestamp not null default now(),
  traite_le timestamp
);

create index if not exists idx_paiements_saspay_etab
  on paiements_saspay (etablissement_id, recu_le desc);
create index if not exists idx_paiements_saspay_reference
  on paiements_saspay (reference);

-- Aucune policy : la table n'est lisible/écrivable que par le service_role
-- (donc par l'Edge Function). Les clients (anon/authenticated) n'y accèdent pas.
alter table paiements_saspay enable row level security;

-- 2) Colonnes de suivi d'abonnement
-- ------------------------------------------------------------
alter table etablissements add column if not exists abonne_le timestamp;
alter table etablissements add column if not exists abonnement_expire_le timestamp;

-- 3) Résolution d'un établissement depuis le préfixe de référence
--    « CCI-A1B2C3-202609-pro » → les 6 premiers caractères de l'UUID.
-- ------------------------------------------------------------
create or replace function public.resoudre_etablissement_par_prefixe(p_prefixe text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from etablissements
  where length(p_prefixe) >= 4
    and replace(id::text, '-', '') ilike p_prefixe || '%'
  order by date_creation asc
  limit 1;
$$;

revoke all on function public.resoudre_etablissement_par_prefixe(text) from public, anon, authenticated;
grant execute on function public.resoudre_etablissement_par_prefixe(text) to service_role;

-- 4) Traitement d'une notification (idempotent, appelé par le webhook)
-- ------------------------------------------------------------
-- Renvoie un JSON : { ok, duplique, statut, etablissement_id, plan }
create or replace function public.traiter_paiement_saspay(
  p_transaction_id text,
  p_reference text default null,
  p_etablissement_id uuid default null,
  p_plan text default null,
  p_montant numeric default null,
  p_devise text default 'XOF',
  p_telephone text default null,
  p_reussi boolean default false,
  p_evenement text default null,
  p_signature_valide boolean default false,
  p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_etab uuid := p_etablissement_id;
  v_plan text;
  v_statut text;
  v_ligne paiements_saspay;
  v_prefixe text;
begin
  -- Idempotence : une même transaction n'est jamais traitée deux fois.
  select * into v_ligne from paiements_saspay where transaction_id = p_transaction_id;
  if found then
    return jsonb_build_object(
      'ok', true,
      'duplique', true,
      'statut', v_ligne.statut,
      'etablissement_id', v_ligne.etablissement_id,
      'plan', v_ligne.plan
    );
  end if;

  -- 4.a Retrouver l'établissement : id transmis → demande en attente →
  --     préfixe de référence (CCI-XXXXXX-AAAAMM-plan).
  if v_etab is null and p_reference is not null then
    select etablissement_id into v_etab
    from demandes_paiement
    where reference_wave = p_reference
      and statut = 'en_attente'
    order by cree_le desc
    limit 1;
  end if;

  if v_etab is null and p_reference is not null then
    v_prefixe := substring(p_reference from '^CCI-([A-Za-z0-9]{4,8})');
    if v_prefixe is not null then
      v_etab := public.resoudre_etablissement_par_prefixe(v_prefixe);
    end if;
  end if;

  -- 4.b Déterminer le forfait : celui annoncé, sinon celui de la demande,
  --     sinon celui déjà en place, sinon starter.
  v_plan := lower(coalesce(p_plan, ''));
  if v_plan not in ('starter', 'pro', 'entreprise') then
    v_plan := null;
  end if;

  if v_plan is null and p_reference is not null then
    select plan into v_plan
    from demandes_paiement
    where reference_wave = p_reference
    order by cree_le desc
    limit 1;
  end if;

  if v_plan is null and v_etab is not null then
    select plan into v_plan from etablissements where id = v_etab;
  end if;

  v_plan := coalesce(v_plan, 'starter');
  v_statut := case when p_reussi then 'valide' else 'echoue' end;

  -- 4.c Journalisation (toujours, même si l'établissement est introuvable).
  insert into paiements_saspay (
    transaction_id, reference, etablissement_id, plan, montant, devise,
    telephone_payeur, statut, evenement, signature_valide, payload, traite_le
  ) values (
    p_transaction_id, p_reference, v_etab, v_plan, p_montant, coalesce(p_devise, 'XOF'),
    p_telephone, v_statut, p_evenement, p_signature_valide, p_payload,
    case when p_reussi then now() else null end
  )
  returning * into v_ligne;

  -- 4.d Activation de l'abonnement (30 jours à compter du paiement).
  if p_reussi and v_etab is not null then
    update etablissements
      set abonnement_actif = true,
          plan = v_plan,
          abonne_le = coalesce(abonne_le, now()),
          abonnement_expire_le = now() + make_interval(days => 30)
      where id = v_etab;

    -- Clôture la demande manuelle correspondante, si elle existe.
    update demandes_paiement
      set statut = 'valide',
          traite_le = now(),
          note_admin = coalesce(note_admin, '') || ' Activé par webhook SasPay (' || p_transaction_id || ').'
      where etablissement_id = v_etab
        and statut = 'en_attente'
        and (p_reference is null or reference_wave = p_reference);
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplique', false,
    'statut', v_statut,
    'etablissement_id', v_etab,
    'plan', v_plan,
    'paiement_id', v_ligne.id
  );
end;
$$;

revoke all on function public.traiter_paiement_saspay(text, text, uuid, text, numeric, text, text, boolean, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.traiter_paiement_saspay(text, text, uuid, text, numeric, text, text, boolean, text, boolean, jsonb) to service_role;

-- 5) Vue de contrôle pour l'admin (SQL Editor, service_role)
-- ------------------------------------------------------------
create or replace view public.v_paiements_saspay as
select
  p.id,
  p.recu_le,
  p.traite_le,
  p.transaction_id,
  p.reference,
  p.plan,
  p.montant,
  p.devise,
  p.telephone_payeur,
  p.statut,
  p.evenement,
  p.signature_valide,
  e.nom as etablissement_nom,
  e.abonnement_actif,
  e.plan as plan_actuel,
  e.abonnement_expire_le
from paiements_saspay p
left join etablissements e on e.id = p.etablissement_id
order by p.recu_le desc;

-- Admin — exemples :
--   select * from v_paiements_saspay limit 50;
--   select public.traiter_paiement_saspay('TXN-123', 'CCI-A1B2C3-202609-pro', null, 'pro', 10000, 'XOF', null, true, 'payment.success', true, '{}'::jsonb);


-- ============================================================================
-- CONTRÔLE FINAL — à exécuter après, pour vérifier que tout est en place
-- ============================================================================
-- select count(*) as types_etablissement from pg_type limit 1;
-- select column_name from information_schema.columns where table_name = 'transactions' and column_name = 'poste_id';
-- select to_regclass('public.factures_fne')   as factures_fne,
--        to_regclass('public.scores_credit')  as scores_credit,
--        to_regclass('public.demandes_paiement') as demandes_paiement,
--        to_regclass('public.paiements_saspay')  as paiements_saspay;
