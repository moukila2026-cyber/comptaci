-- ============================================================
-- COMPTACI — ACTIVATION COMPLÈTE : paiements Wave + tous les plans
-- ============================================================
--
-- À exécuter UNE SEULE FOIS dans le SQL Editor Supabase (Run).
-- Script IDEMPOTENT : tu peux le relancer sans aucun risque.
--
-- Ce que fait ce script :
--   1) Crée la table `demandes_paiement` si elle n'existe pas
--      (c'était la cause de l'erreur 42P01) + ses policies,
--      la fonction de traçage, les RPC `valider_paiement` /
--      `refuser_paiement` et la vue admin `v_paiements_en_attente`.
--   2) Supprime les 2 verrous SQL de l'offre Fondateurs qui
--      ramenaient obligatoirement les fondateurs sur le plan STARTER ;
--      à la fin des 7 jours d'essai, Pro et Entreprise deviennent
--      souscriptibles (Starter garde son tarif 7 000 FCFA à vie).
-- ============================================================

-- ------------------------------------------------------------
-- 0) Fonctions d'aide (si absentes, recréées sans risque)
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
-- 1) Table demandes_paiement (création si absente) + RPC admin
--    Parcours client : scan QR Wave → « J'ai payé » → ligne en_attente.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 2) Déblocage des plans pour les fondateurs
--    (suppression des verrous « STARTER et rien d'autre »)
-- ------------------------------------------------------------

-- 2a) Garde-fou sur etablissements (trigger BEFORE UPDATE)
drop trigger if exists trg_fondateur_plan_starter on etablissements;
drop function if exists public.empecher_sortie_plan_fondateur();

-- 2b) Verrou sur les demandes de paiement (trigger BEFORE INSERT).
--     Protégé : aucun risque d'erreur 42P01 si la table manque.
do $$
begin
  if to_regclass('public.demandes_paiement') is not null then
    execute 'drop trigger if exists trg_demandes_paiement_fondateur on demandes_paiement';
  end if;
  execute 'drop function if exists public.forcer_plan_fondateur_demande()';
end;
$$;

-- ------------------------------------------------------------
-- 3) Vérification automatique
-- ------------------------------------------------------------
do $$
declare
  table_paiements_ok boolean;
  nb_verrous int;
begin
  table_paiements_ok := to_regclass('public.demandes_paiement') is not null;

  select count(*) into nb_verrous
    from pg_trigger
   where tgname in ('trg_fondateur_plan_starter', 'trg_demandes_paiement_fondateur')
     and not tgisinternal;

  if not table_paiements_ok then
    raise exception 'Échec : la table demandes_paiement ne peut pas être créée.';
  end if;
  if nb_verrous > 0 then
    raise exception 'Échec : % verrou(s) fondateur encore présents (%s).', nb_verrous,
      (select string_agg(tgname, ', ') from pg_trigger
        where tgname in ('trg_fondateur_plan_starter', 'trg_demandes_paiement_fondateur')
          and not tgisinternal);
  end if;

  raise notice 'OK — table demandes_paiement prête, verrous fondateur supprimés. Pro et Entreprise sont désormais opérationnels à la fin des 7 jours d''essai.';
end;
$$;

-- ------------------------------------------------------------
-- Contrôles manuels (facultatifs) :
--   select * from v_paiements_en_attente;      -- file d'attente admin
--   select public.valider_paiement('<uuid>');  -- active plan + abonnement
--   select public.places_fondateurs_restantes();
-- ------------------------------------------------------------
