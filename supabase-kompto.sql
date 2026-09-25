-- ============================================================================
--  ComptaCi — KOMPTO — Facture Normalisée Électronique (FNE / DGI CI)
--  Migration KOMPTO v5.2 — à exécuter dans Supabase → SQL Editor
--  Propriété non destructive, idempotente. Peut être rejouée.
--
--  • Colonnes KOMPTO sur `etablissements` (apiKey, establishment, pointOfSale)
--  • Extension de `factures_fne` pour stocker les identifiants KOMPTO
--  • RLS inchangée : un établissement ne voit que ses propres factures
--
--  Prérequis : avoir exécuté supabase-fne.sql et supabase-SETUP-FINAL.sql
--  avant. Ce script ajoute ce qui manque pour parler à https://qa.kompto.com
--  (sandbox) puis au host prod KOMPTO.
--
--  Rappel : l'enrôlement DGI (establishment + pointOfSale) doit préexister
--  sur la plateforme FNE. La clé API KOMPTO (UUID) est liée à ce couple.
--  En sandbox partagé, c'est toujours PROGICI SARL / SIEGE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuration KOMPTO de l'établissement
-- ---------------------------------------------------------------------------
alter table etablissements
  add column if not exists kompto_api_key text;

alter table etablissements
  add column if not exists kompto_base_url text;

alter table etablissements
  add column if not exists kompto_etablissement text;

alter table etablissements
  add column if not exists kompto_point_de_vente text;

-- Valeurs par défaut sandbox (écrasables en prod par établissement)
-- On ne touche pas aux établissements déjà configurés.
update etablissements
   set kompto_base_url = 'https://qa.kompto.com'
 where kompto_base_url is null;

update etablissements
   set kompto_etablissement = 'PROGICI SARL'
 where kompto_etablissement is null;

update etablissements
   set kompto_point_de_vente = 'SIEGE'
 where kompto_point_de_vente is null;

-- Migration douce depuis les anciennes colonnes fne_cle_api / fne_etablissement
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='etablissements' and column_name='fne_cle_api') then
    update etablissements set kompto_api_key = fne_cle_api where kompto_api_key is null and fne_cle_api is not null;
  end if;
end$$;

comment on column etablissements.kompto_api_key is
  'Clé API KOMPTO (UUID) liée à establishment/pointOfSale. Vide = mode brouillon. Ne jamais logger en clair.';
comment on column etablissements.kompto_base_url is
  'Hôte KOMPTO : https://qa.kompto.com en sandbox, host prod fourni par KOMPTO en production.';
comment on column etablissements.kompto_etablissement is
  'Establishment KOMPTO / DGI, sensible à la casse. PROGICI SARL en sandbox partagé.';
comment on column etablissements.kompto_point_de_vente is
  'Point de vente KOMPTO / DGI à l''intérieur de l''establishment. SIEGE en sandbox.';

-- ---------------------------------------------------------------------------
-- 2. Factures — enrichissement KOMPTO
-- ---------------------------------------------------------------------------
-- table factures_fne existe déjà via supabase-fne.sql
alter table factures_fne
  add column if not exists kompto_entry_id text;

alter table factures_fne
  add column if not exists kompto_item_ids jsonb;

alter table factures_fne
  add column if not exists number_fne text;

alter table factures_fne
  add column if not exists link_fne text;

alter table factures_fne
  add column if not exists type_fne text;

alter table factures_fne
  add column if not exists date_time_fne text;

alter table factures_fne
  add column if not exists entry_timbre numeric(14,2);

alter table factures_fne
  add column if not exists sticker_fne_balance integer;

alter table factures_fne
  add column if not exists kompto_parent_id text;

-- Garde-fou : number_fne est l'identifiant officiel DGI (19 chars, A + 18 pour avoir)
create index if not exists factures_fne_number_fne_idx on factures_fne (number_fne);
create index if not exists factures_fne_kompto_entry_idx on factures_fne (kompto_entry_id);

comment on column factures_fne.kompto_entry_id is
  'Identifiant KOMPTO (komptoEntryId) — id de commande côté KOMPTO. Null pour les brouillons locaux pré-KOMPTO.';
comment on column factures_fne.kompto_item_ids is
  'Tableau des komptoItemId par ligne, nécessaire pour createCreditNote.';
comment on column factures_fne.number_fne is
  'Numéro normé DGI (19 chars). Préfixé A pour les avoirs. Null tant que non certifié.';
comment on column factures_fne.link_fne is
  'Lien public de vérification DGI.';

-- ---------------------------------------------------------------------------
-- 3. Crédits / avoirs — on réutilise factures_fne avec type_fne = ''Credit Note''
-- ---------------------------------------------------------------------------
-- Aucune table supplémentaire : un avoir est une facture certifiée de type Credit Note
-- avec kompto_parent_id = komptoEntryId de la facture d'origine.

-- ---------------------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------------------
-- select id, nom, kompto_etablissement, kompto_point_de_vente, case when kompto_api_key is null then 'brouillon' else 'key_present' end as mode from etablissements limit 10;
-- select statut, type_fne, count(*) from factures_fne group by statut, type_fne;
-- select number_fne, link_fne, entry_timbre, date_time_fne from factures_fne where number_fne is not null order by date_emission desc limit 20;
