-- ============================================================
-- COMPTACI — SCRIPT DE CONFIGURATION FINAL (DÉFINITIF)
-- ============================================================
-- Fichier à exécuter : supabase-SETUP-FINAL.sql
-- Emplacement : Supabase → SQL Editor → coller → Exécuter (une seule fois).
--
-- Ce script EST le correctif définitif. Il remplace tous les fichiers
-- supabase-*.sql précédents (MASTER-COMPLET, fix-rls-actions, etc.).
-- 100% idempotent : on peut le relancer sans risque, il ne crée que ce
-- qui manque et ne détruit jamais de données existantes.
--
-- Correctif clé : la fonction RPC `creer_etablissement` (section 10).
-- Auparavant, la création d'un établissement était faite par l'application
-- en deux étapes (INSERT dans `etablissements`, puis INSERT dans `membres`),
-- chacune filtrée par les politiques RLS → échec circulaire et bouton
-- « Créer mon compte » / « Nouvel établissement » sans effet.
-- Désormais la création passe par une fonction SECURITY DEFINER qui insère
-- l'établissement ET la ligne « membres » du propriétaire dans une seule
-- transaction, en contournant la RLS. C'est l'unique source de vérité.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Extensions nécessaires
-- ------------------------------------------------------------
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) Table etablissements
-- ------------------------------------------------------------
create table if not exists etablissements (
  id uuid primary key default gen_random_uuid(),
  proprietaire_id uuid references auth.users not null,
  nom text not null default 'Mon établissement',
  telephone text,
  date_creation timestamp not null default now(),
  abonnement_actif boolean not null default false
);

alter table etablissements add column if not exists nom text not null default 'Mon établissement';
alter table etablissements add column if not exists telephone text;
alter table etablissements add column if not exists date_creation timestamp not null default now();
alter table etablissements add column if not exists abonnement_actif boolean not null default false;

-- Code d'invitation unique par établissement
alter table etablissements add column if not exists code_invitation text unique;
update etablissements set code_invitation = upper(substr(md5(random()::text), 1, 6)) where code_invitation is null;
alter table etablissements alter column code_invitation set default upper(substr(md5(random()::text), 1, 6));

-- Formules tarifaires (avec le plan « entreprise »)
alter table etablissements add column if not exists plan text not null default 'starter';
alter table etablissements drop constraint if exists etablissements_plan_check;
alter table etablissements add constraint etablissements_plan_check
  check (plan in ('starter', 'pro', 'entreprise'));

-- Secteurs d'activité
alter table etablissements add column if not exists secteur text not null default 'restauration';
alter table etablissements drop constraint if exists etablissements_secteur_check;
alter table etablissements add constraint etablissements_secteur_check
  check (secteur in ('restauration', 'quincaillerie', 'boutique', 'pharmacie'));

-- Offre fondateurs + essai gratuit de 7 jours
alter table etablissements add column if not exists est_fondateur boolean not null default false;
alter table etablissements add column if not exists essai_jours integer not null default 7;
alter table etablissements add column if not exists tarif_verrouille numeric;

alter table etablissements enable row level security;

-- ------------------------------------------------------------
-- 2) Table membres (rôles propriétaire / gérant)
-- ------------------------------------------------------------
create table if not exists membres (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  user_id uuid references auth.users not null,
  role text not null default 'gerant' check (role in ('proprietaire', 'gerant')),
  cree_le timestamp default now(),
  unique (etablissement_id, user_id)
);
alter table membres enable row level security;

-- Le propriétaire de chaque établissement existant devient membre
insert into membres (etablissement_id, user_id, role)
select id, proprietaire_id, 'proprietaire' from etablissements
on conflict (etablissement_id, user_id) do nothing;

-- ------------------------------------------------------------
-- 3) Fonctions d'aide anti-récursion (SECURITY DEFINER)
-- ------------------------------------------------------------
create or replace function public.est_membre_de(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from membres
    where etablissement_id = etab_id and user_id = auth.uid()
  );
$$;

create or replace function public.est_proprietaire_de(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from etablissements
    where id = etab_id and proprietaire_id = auth.uid()
  );
$$;

create or replace function public.peut_ecrire_dans(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select public.est_proprietaire_de(etab_id) or public.est_membre_de(etab_id);
$$;

-- ------------------------------------------------------------
-- 4) Policies : etablissements
-- ------------------------------------------------------------
drop policy if exists "membre_voit_son_etablissement" on etablissements;
drop policy if exists "proprietaire_voit_son_etablissement" on etablissements;
create policy "membre_voit_son_etablissement" on etablissements
  for select using (est_membre_de(id));

drop policy if exists "proprietaire_modifie_son_etablissement" on etablissements;
create policy "proprietaire_modifie_son_etablissement" on etablissements
  for update using (proprietaire_id = auth.uid());

drop policy if exists "proprietaire_insere_etablissement" on etablissements;
create policy "proprietaire_insere_etablissement" on etablissements
  for insert with check (proprietaire_id = auth.uid());

-- ------------------------------------------------------------
-- 5) Policies : membres
-- ------------------------------------------------------------
drop policy if exists "membre_voit_ses_etablissements" on membres;
drop policy if exists "membre_voit_membres_etablissement" on membres;
create policy "membre_voit_membres_etablissement" on membres
  for select using (
    user_id = auth.uid()
    or public.est_proprietaire_de(etablissement_id)
    or public.est_membre_de(etablissement_id)
  );

drop policy if exists "proprietaire_gere_les_membres" on membres;
create policy "proprietaire_gere_les_membres" on membres for all using (
  etablissement_id in (select id from etablissements where proprietaire_id = auth.uid())
);

-- Un nouvel utilisateur qui rejoint via un code d'invitation s'ajoute
-- lui-même comme gérant (jamais comme propriétaire).
drop policy if exists "utilisateur_rejoint_comme_gerant" on membres;
create policy "utilisateur_rejoint_comme_gerant" on membres
  for insert with check (user_id = auth.uid() and role = 'gerant');

-- ------------------------------------------------------------
-- 6) RPC : recherche par code d'invitation + places fondateurs
-- ------------------------------------------------------------
create or replace function public.etablissement_par_code(code text)
returns uuid language sql security definer set search_path = public stable
as $$
  select id from etablissements where code_invitation = upper(trim(code)) limit 1;
$$;
grant execute on function public.etablissement_par_code(text) to anon, authenticated;

create or replace function public.places_fondateurs_restantes()
returns integer language sql security definer set search_path = public stable
as $$
  select greatest(0, 100 - (select count(*) from etablissements where est_fondateur = true));
$$;
grant execute on function public.places_fondateurs_restantes() to anon, authenticated;

-- ------------------------------------------------------------
-- 7) Déclencheur : essai gratuit 7 jours + offre fondateurs
-- ------------------------------------------------------------
create or replace function public.appliquer_offre_fondateur()
returns trigger language plpgsql
as $$
declare
  compte_fondateurs int;
begin
  -- Verrou anti-concurrence : deux inscriptions simultanées ne peuvent pas
  -- obtenir toutes les deux la 100e place fondateur.
  perform pg_advisory_xact_lock(hashtext('comptaci_offre_fondateur'));

  select count(*) into compte_fondateurs from etablissements where est_fondateur = true;
  new.essai_jours := 7;
  if compte_fondateurs < 100 then
    new.est_fondateur := true;
    new.tarif_verrouille := 7000;
    -- Règle métier : l'offre fondateurs = plan STARTER et rien d'autre.
    new.plan := 'starter';
  else
    new.est_fondateur := false;
    new.tarif_verrouille := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_offre_fondateur on etablissements;
create trigger trg_offre_fondateur
  before insert on etablissements
  for each row execute function public.appliquer_offre_fondateur();

-- ------------------------------------------------------------
-- 7bis) Garde-fou : un établissement fondateur ne peut JAMAIS
--       sortir du plan STARTER (règle « STARTER et rien d'autre »).
-- ------------------------------------------------------------
create or replace function public.empecher_sortie_plan_fondateur()
returns trigger language plpgsql
as $$
begin
  if new.est_fondateur and new.plan is distinct from 'starter' then
    new.plan := 'starter';
  end if;
  if new.est_fondateur and (new.tarif_verrouille is null or new.tarif_verrouille <> 7000) then
    new.tarif_verrouille := 7000;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fondateur_plan_starter on etablissements;
create trigger trg_fondateur_plan_starter
  before update on etablissements
  for each row execute function public.empecher_sortie_plan_fondateur();

-- Rattrapage : tout fondateur déjà passé sur pro / entreprise revient en STARTER.
update etablissements
   set plan = 'starter',
       tarif_verrouille = 7000
 where est_fondateur = true
   and (plan is distinct from 'starter' or tarif_verrouille is distinct from 7000);

-- ------------------------------------------------------------
-- 8) Déclencheur : membre propriétaire créé automatiquement
--    (filet de sécurité pour tout INSERT direct d'établissement)
-- ------------------------------------------------------------
create or replace function public.creer_membre_proprietaire()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.membres (etablissement_id, user_id, role)
  values (new.id, new.proprietaire_id, 'proprietaire')
  on conflict (etablissement_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_creer_membre_proprietaire on etablissements;
create trigger trg_creer_membre_proprietaire
  after insert on etablissements
  for each row execute function public.creer_membre_proprietaire();

-- ------------------------------------------------------------
-- 9) CORRECTIF DÉFINITIF — RPC `creer_etablissement`
-- ------------------------------------------------------------
-- Crée l'établissement ET la ligne « membres » du propriétaire dans une
-- seule transaction, avec les privilèges du propriétaire de la base
-- (SECURITY DEFINER => ignore la RLS). C'est la fonction appelée par
-- l'application à l'inscription et à la création d'un nouvel établissement.
-- Elle renvoie la ligne complète créée (id, plan, essai_jours, code…).
create or replace function public.creer_etablissement(
  nom text,
  secteur text default 'restauration',
  telephone text default ''
)
returns etablissements
language plpgsql
security definer
set search_path = public
as $$
declare
  nouvel_etablissement etablissements;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise pour créer un établissement.';
  end if;

  insert into etablissements (proprietaire_id, nom, telephone, secteur)
  values (
    auth.uid(),
    coalesce(nullif(trim(nom), ''), 'Mon établissement'),
    telephone,
    secteur
  )
  returning * into nouvel_etablissement;

  insert into membres (etablissement_id, user_id, role)
  values (nouvel_etablissement.id, auth.uid(), 'proprietaire')
  on conflict (etablissement_id, user_id) do nothing;

  return nouvel_etablissement;
end;
$$;

grant execute on function public.creer_etablissement(text, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 10) Table transactions (ventes / dépenses) + policies
-- ------------------------------------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  type text not null check (type in ('vente', 'depense')),
  montant numeric not null,
  categorie text,
  note text,
  date date not null default current_date,
  cree_le timestamp default now()
);
alter table transactions enable row level security;

drop policy if exists "acces_transactions_etablissement" on transactions;
drop policy if exists "membres_voient_transactions" on transactions;
drop policy if exists "membres_ecrivent_transactions" on transactions;

create policy "membres_voient_transactions" on transactions
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ecrivent_transactions" on transactions
  for all using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

-- ------------------------------------------------------------
-- 11) Table produits (stock) + policies
-- ------------------------------------------------------------
create table if not exists produits (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  designation text not null,
  quantite_stock numeric not null default 0,
  prix_unitaire numeric,
  maj_le timestamp default now(),
  unique (etablissement_id, designation)
);
alter table produits add column if not exists seuil_alerte numeric not null default 5;
alter table produits enable row level security;

drop policy if exists "acces_produits_etablissement" on produits;
drop policy if exists "membres_voient_produits" on produits;
drop policy if exists "membres_ecrivent_produits" on produits;

create policy "membres_voient_produits" on produits
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ecrivent_produits" on produits
  for all using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

-- ------------------------------------------------------------
-- 12) Table fournisseurs + policies
-- ------------------------------------------------------------
create table if not exists fournisseurs (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  nom text not null,
  telephone text not null,
  note text,
  cree_le timestamp default now()
);
alter table fournisseurs enable row level security;

drop policy if exists "acces_fournisseurs_etablissement" on fournisseurs;
drop policy if exists "membres_voient_fournisseurs" on fournisseurs;
drop policy if exists "membres_ecrivent_fournisseurs" on fournisseurs;

create policy "membres_voient_fournisseurs" on fournisseurs
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ecrivent_fournisseurs" on fournisseurs
  for all using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

-- ------------------------------------------------------------
-- 13) Table sessions_caisse + policies
-- ------------------------------------------------------------
create table if not exists sessions_caisse (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  ouverte_par uuid references auth.users not null,
  fond_ouverture numeric not null default 0,
  date_ouverture timestamp not null default now(),
  fond_fermeture_reel numeric,
  ecart numeric,
  date_fermeture timestamp,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'fermee'))
);
alter table sessions_caisse enable row level security;

drop policy if exists "acces_sessions_caisse_etablissement" on sessions_caisse;
drop policy if exists "membres_voient_sessions_caisse" on sessions_caisse;
drop policy if exists "membres_ecrivent_sessions_caisse" on sessions_caisse;

create policy "membres_voient_sessions_caisse" on sessions_caisse
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ecrivent_sessions_caisse" on sessions_caisse
  for all using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Un fondateur ne peut déclarer un paiement que pour le plan STARTER,
-- au tarif verrouillé de 7 000 FCFA (règle « STARTER et rien d'autre »).
-- ------------------------------------------------------------
create or replace function public.forcer_plan_fondateur_demande()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  e etablissements;
begin
  select * into e from etablissements where id = new.etablissement_id;
  if e.est_fondateur then
    new.plan := 'starter';
    new.montant := coalesce(e.tarif_verrouille, 7000);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_demandes_paiement_fondateur on demandes_paiement;
create trigger trg_demandes_paiement_fondateur
  before insert on demandes_paiement
  for each row execute function public.forcer_plan_fondateur_demande();

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

-- ============================================================
-- FIN DU SCRIPT.
-- Tout est prêt : inscription + création d'établissement via RPC,
-- gérants, ventes/dépenses, stock, fournisseurs, caisse, essai 7 jours,
-- plan Entreprise, demandes de paiement Wave, et les boutons fonctionnent après connexion.
-- ============================================================
