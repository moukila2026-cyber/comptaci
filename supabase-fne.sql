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
