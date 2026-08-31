-- ============================================================
-- SCRIPT MAÎTRE COMPTACI — VERSION COMPLÈTE ET DÉFINITIVE
-- ============================================================
-- À exécuter EN UNE FOIS dans Supabase → SQL Editor.
-- 100% idempotent : peut être relancé autant de fois que
-- nécessaire, même si certains morceaux (supabase-roles.sql,
-- supabase-stock.sql, etc.) ont déjà été exécutés avant.
--
-- Ce script remplace TOUS les fichiers supabase-*.sql précédents.
-- Il corrige les bugs suivants :
--  - "Ajout de produits dans stocks impossible"      → colonne
--    produits.seuil_alerte manquante + policy RLS
--  - "Message d'erreur en entrant un mouvement"      → table
--    transactions / fonction est_membre_de manquantes
--  - "Bouton d'ajout de gérant invisible"             → colonne
--    code_invitation + table membres manquantes
--  - "Fonctionnalités manquantes" (fournisseurs, caisse) → tables
--    fournisseurs / sessions_caisse manquantes
--  - Essai gratuit 7 jours + plan Entreprise
-- ============================================================

-- ------------------------------------------------------------
-- 0) Extensions nécessaires
-- ------------------------------------------------------------
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) Table etablissements (créée seulement si totalement absente)
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

-- Formules tarifaires (avec le plan "entreprise")
alter table etablissements add column if not exists plan text not null default 'starter';
alter table etablissements drop constraint if exists etablissements_plan_check;
alter table etablissements add constraint etablissements_plan_check
  check (plan in ('starter', 'pro', 'entreprise'));

-- Secteurs d'activité
alter table etablissements add column if not exists secteur text not null default 'restauration';
alter table etablissements drop constraint if exists etablissements_secteur_check;
alter table etablissements add constraint etablissements_secteur_check
  check (secteur in ('restauration', 'quincaillerie', 'boutique', 'pharmacie'));

-- Offre fondateurs + essai gratuit de 7 jours pour tout le monde
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

-- Le propriétaire de chaque établissement existant devient automatiquement membre
insert into membres (etablissement_id, user_id, role)
select id, proprietaire_id, 'proprietaire' from etablissements
on conflict (etablissement_id, user_id) do nothing;

-- ------------------------------------------------------------
-- 3) Fonction anti-récursion utilisée par toutes les policies RLS
-- ------------------------------------------------------------
create or replace function public.est_membre_de(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (select 1 from membres where etablissement_id = etab_id and user_id = auth.uid());
$$;

-- ------------------------------------------------------------
-- 4) Policies : etablissements
-- ------------------------------------------------------------
drop policy if exists "membre_voit_son_etablissement" on etablissements;
drop policy if exists "proprietaire_voit_son_etablissement" on etablissements;
create policy "membre_voit_son_etablissement" on etablissements for select using (est_membre_de(id));

drop policy if exists "proprietaire_modifie_son_etablissement" on etablissements;
create policy "proprietaire_modifie_son_etablissement" on etablissements for update using (proprietaire_id = auth.uid());

drop policy if exists "proprietaire_insere_etablissement" on etablissements;
create policy "proprietaire_insere_etablissement" on etablissements for insert with check (proprietaire_id = auth.uid());

-- ------------------------------------------------------------
-- 5) Policies : membres
-- ------------------------------------------------------------
drop policy if exists "membre_voit_ses_etablissements" on membres;
create policy "membre_voit_ses_etablissements" on membres for select using (user_id = auth.uid());

drop policy if exists "proprietaire_gere_les_membres" on membres;
create policy "proprietaire_gere_les_membres" on membres for all using (
  etablissement_id in (select id from etablissements where proprietaire_id = auth.uid())
);

-- Un nouvel utilisateur qui rejoint via un code d'invitation doit pouvoir
-- s'ajouter lui-même comme gérant (jamais comme propriétaire).
drop policy if exists "utilisateur_rejoint_comme_gerant" on membres;
create policy "utilisateur_rejoint_comme_gerant" on membres
  for insert with check (user_id = auth.uid() and role = 'gerant');

-- ------------------------------------------------------------
-- 6) Fonctions RPC : recherche par code d'invitation + compteur fondateurs
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
-- 7) Déclencheur : essai gratuit 7 jours pour tous + offre fondateurs
--    (100 premiers établissements créés, tarif verrouillé à vie)
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
    -- Règle métier : l'offre fondateurs démarre sur le plan STARTER
    -- (7 000 FCFA) ; le choix de Pro / Entreprise s'ouvre à la fin des 7 jours.
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
-- 7bis) Garde-fou : PENDANT l'offre fondateurs (fenêtre de 7 jours),
--       un fondateur reste sur STARTER / 7 000 FCFA. Une fois la
--       fenêtre passée, il choisit librement Starter, Pro ou
--       Entreprise : le garde-fou ne s'applique plus.
--       Fenêtre : now() < date_creation + make_interval(days => coalesce(essai_jours, 7))
-- ------------------------------------------------------------
create or replace function public.empecher_sortie_plan_fondateur()
returns trigger language plpgsql
as $$
begin
  if new.est_fondateur
     and now() < coalesce(new.date_creation, now())
                 + make_interval(days => coalesce(new.essai_jours, 7)) then
    if new.plan is distinct from 'starter' then
      new.plan := 'starter';
    end if;
    if new.tarif_verrouille is null or new.tarif_verrouille <> 7000 then
      new.tarif_verrouille := 7000;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fondateur_plan_starter on etablissements;
create trigger trg_fondateur_plan_starter
  before update on etablissements
  for each row execute function public.empecher_sortie_plan_fondateur();

-- Rattrapage : un fondateur ENCORE dans sa fenêtre d'offre et déjà passé sur
-- pro / entreprise revient en STARTER. Un fondateur hors offre (essai terminé)
-- qui a choisi Pro ou Entreprise n'est jamais touché.
update etablissements
   set plan = 'starter',
       tarif_verrouille = 7000
 where est_fondateur = true
   and (plan is distinct from 'starter' or tarif_verrouille is distinct from 7000)
   and now() < date_creation + make_interval(days => coalesce(essai_jours, 7));

-- ------------------------------------------------------------
-- 8) Table transactions (ventes / dépenses)
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
create policy "acces_transactions_etablissement" on transactions for all using (est_membre_de(etablissement_id));

-- ------------------------------------------------------------
-- 9) Table produits (gestion de stock)
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
-- Colonne du seuil d'alerte de stock bas (bug "ajout de produit impossible")
alter table produits add column if not exists seuil_alerte numeric not null default 5;

alter table produits enable row level security;
drop policy if exists "acces_produits_etablissement" on produits;
create policy "acces_produits_etablissement" on produits for all using (est_membre_de(etablissement_id));

-- ------------------------------------------------------------
-- 10) Table fournisseurs
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
create policy "acces_fournisseurs_etablissement" on fournisseurs for all using (est_membre_de(etablissement_id));

-- ------------------------------------------------------------
-- 11) Table sessions_caisse
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
create policy "acces_sessions_caisse_etablissement" on sessions_caisse for all using (est_membre_de(etablissement_id));

-- ============================================================
-- FIN DU SCRIPT — Tout est prêt : gérants, mouvements, stock,
-- fournisseurs, caisse, essai 7 jours, plan Entreprise.
-- ============================================================
