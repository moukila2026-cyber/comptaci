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
