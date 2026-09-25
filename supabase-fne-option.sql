-- ============================================================================
--  ComptaCi — FNE Option Payante (100 000 FCFA / an / établissement)
--  À exécuter dans Supabase → SQL Editor, APRES supabase-kompto.sql
--  Idempotent. Peut être rejoué.
--
--  • fne_statut : aucune | en_cours | active | expiree
--  • fne_expiration_date : date d'échéance annuelle (paiement + 1 an)
--  • fne_ncc : NCC déjà stocké via fne_numero_contribuable, on ajoute alias si besoin
--  • Journalisation des paiements FNE (table fne_paiements ou vue)
--
--  Principe commercial (Partie 2) : plans inchangés (7000/10000/20000).
--  FNE option séparée 100k/an via SasPay (coût KOMPTO 80k, marge 20k).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colonnes d'option FNE sur etablissements
-- ---------------------------------------------------------------------------
alter table etablissements
  add column if not exists fne_statut text not null default 'aucune'
  check (fne_statut in ('aucune', 'en_cours', 'active', 'expiree'));

alter table etablissements
  add column if not exists fne_expiration_date date;

alter table etablissements
  add column if not exists fne_ncc text;

-- Aliases / confort : si fne_numero_contribuable existe, recopier vers fne_ncc pour uniformité
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='etablissements' and column_name='fne_numero_contribuable') then
    update etablissements set fne_ncc = fne_numero_contribuable where fne_ncc is null and fne_numero_contribuable is not null;
  end if;
end$$;

-- Garde-fou : fne_active legacy → fne_statut active si besoin
do $$
begin
  if exists (select 1 from information_schema.columns where table_name='etablissements' and column_name='fne_active') then
    update etablissements set fne_statut = 'active' where fne_active = true and fne_statut = 'aucune';
  end if;
end$$;

comment on column etablissements.fne_statut is
  'Option FNE : aucune (pas de FNE ou méthode séparée), en_cours (payé, attente connexion KOMPTO), active (certification OK), expiree (échéance dépassée)';
comment on column etablissements.fne_expiration_date is
  'Échéance annuelle de l''option FNE (paiement + 365j). Si dépassée sans renouvellement → expiree';

-- Index pour les crons / vérifs
create index if not exists idx_etablissements_fne_statut on etablissements (fne_statut);
create index if not exists idx_etablissements_fne_exp on etablissements (fne_expiration_date);

-- ---------------------------------------------------------------------------
-- 2. Table journal FNE (paiements dédiés, pour diagnostic)
-- ---------------------------------------------------------------------------
create table if not exists fne_paiements (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references etablissements on delete cascade,
  transaction_id text,                 -- id SasPay
  reference text,                      -- ref SasPay (ex: CCI-XXXXXX-...)
  montant numeric not null default 100000,
  devise text not null default 'XOF',
  statut text not null default 'en_attente' check (statut in ('en_attente','valide','echoue','refuse','rembourse')),
  produit text not null default 'fne_option_100k',
  payload jsonb,
  cree_le timestamp not null default now(),
  traite_le timestamp
);

alter table fne_paiements enable row level security;

drop policy if exists "fne_paiements_visibles_par_membres" on fne_paiements;
create policy "fne_paiements_visibles_par_membres"
  on fne_paiements for select
  using (exists (select 1 from membres m where m.etablissement_id = fne_paiements.etablissement_id and m.user_id = auth.uid()));

-- insertion autorisée par les membres (et le webhook service_role contourne la RLS)
drop policy if exists "fne_paiements_insertion_par_membres" on fne_paiements;
create policy "fne_paiements_insertion_par_membres"
  on fne_paiements for insert
  with check (exists (select 1 from membres m where m.etablissement_id = fne_paiements.etablissement_id and m.user_id = auth.uid()));

create index if not exists idx_fne_paiements_etab on fne_paiements (etablissement_id, cree_le desc);
create index if not exists idx_fne_paiements_ref on fne_paiements (reference);

comment on table fne_paiements is
  'Journal des paiements de l''option FNE (100k/an). Alimenté par le webhook SasPay et/ou manuellement.';

-- ---------------------------------------------------------------------------
-- 3. Fonction d'activation FNE (appelée par le webhook)
-- ---------------------------------------------------------------------------
create or replace function public.activer_option_fne(
  p_etablissement_id uuid,
  p_transaction_id text default null,
  p_reference text default null,
  p_montant numeric default 100000,
  p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp date;
begin
  if p_etablissement_id is null then
    return jsonb_build_object('ok', false, 'erreur', 'etablissement_id manquant');
  end if;

  -- Idempotence partielle : si un paiement identique existe déjà en valide, on ne recrée pas
  if p_transaction_id is not null then
    if exists (select 1 from fne_paiements where transaction_id = p_transaction_id and statut = 'valide') then
      return jsonb_build_object('ok', true, 'duplique', true);
    end if;
  end if;

  v_exp := (now() + make_interval(days => 365))::date;

  -- Journal
  insert into fne_paiements (etablissement_id, transaction_id, reference, montant, statut, payload, traite_le)
  values (p_etablissement_id, coalesce(p_transaction_id, 'manual-'||gen_random_uuid()::text), p_reference, coalesce(p_montant,100000), 'valide', p_payload, now())
  on conflict do nothing;

  -- Activation sans toucher au plan d'abonnement
  update etablissements
     set fne_statut = 'en_cours',
         fne_expiration_date = greatest(coalesce(fne_expiration_date, '2000-01-01'::date), v_exp)
   where id = p_etablissement_id;

  return jsonb_build_object('ok', true, 'etablissement_id', p_etablissement_id, 'expiration', v_exp, 'statut', 'en_cours');
end;
$$;

revoke all on function public.activer_option_fne(uuid, text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.activer_option_fne(uuid, text, text, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Expiration automatique (à appeler quotidiennement ou à chaque lecture)
-- ---------------------------------------------------------------------------
create or replace function public.expirer_fne_si_echue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update etablissements
     set fne_statut = 'expiree'
   where fne_statut in ('en_cours','active')
     and fne_expiration_date is not null
     and fne_expiration_date < current_date;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.expirer_fne_si_echue() from public, anon, authenticated;
grant execute on function public.expirer_fne_si_echue() to anon, authenticated, service_role;

-- Exécuter une première fois pour nettoyer les expirés historiques
select public.expirer_fne_si_echue();

-- ---------------------------------------------------------------------------
-- 5. Passage en active après connexion KOMPTO réussie
-- ---------------------------------------------------------------------------
create or replace function public.confirmer_fne_active(p_etablissement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update etablissements
     set fne_statut = 'active'
   where id = p_etablissement_id
     and fne_statut in ('en_cours','expiree','aucune')
     and fne_expiration_date is not null
     and fne_expiration_date >= current_date;
  -- Si pas d'échéance (ancien établissement), on tolère le passage en active quand même si en_cours
  update etablissements
     set fne_statut = 'active'
   where id = p_etablissement_id
     and fne_statut = 'en_cours'
     and fne_expiration_date is null;

  return jsonb_build_object('ok', true, 'etablissement_id', p_etablissement_id);
end;
$$;

revoke all on function public.confirmer_fne_active(uuid) from public, anon, authenticated;
grant execute on function public.confirmer_fne_active(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Vue de diagnostic
-- ---------------------------------------------------------------------------
create or replace view public.v_fne_etablissements as
select
  e.id,
  e.nom,
  e.plan,
  e.fne_statut,
  e.fne_expiration_date,
  e.fne_ncc,
  e.kompto_etablissement,
  e.kompto_point_de_vente,
  e.kompto_base_url,
  case when e.kompto_api_key is not null then 'key_present' else 'no_key' end as kompto_key,
  e.abonnement_actif,
  e.date_creation
from etablissements e
order by e.date_creation desc;

-- Vérifs :
-- select * from v_fne_etablissements where fne_statut != 'aucune';
-- select * from fne_paiements order by cree_le desc limit 20;
-- select public.expirer_fne_si_echue();

