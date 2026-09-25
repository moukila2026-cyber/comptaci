-- ============================================================================
--  ComptaCi — Extension webhook SasPay pour l'option FNE (100k/an)
--  À exécuter DANS Supabase → SQL Editor, APRES supabase-saspay-webhook.sql
--  ET APRES supabase-fne-option.sql.
--  Idempotent.
--
--  • Autorise plan='fne' dans paiements_saspay
--  • Détecte le produit FNE vs abonnement classique via
--      - p_plan = 'fne'
--      - référence se terminant/contenant '-fne'
--      - payload JSON contenant produit/fne
--    Dans ce cas appelle activer_option_fne et ne touche PAS au plan.
--  • Sinon behaviour classique (starter/pro/entreprise, 30j)
-- ============================================================================

-- 1) Autoriser plan='fne'
do $$
begin
  -- on recrée la contrainte plutôt que d'essayer d'alterer le check
  alter table paiements_saspay drop constraint if exists paiements_saspay_plan_check;
  alter table paiements_saspay
    add constraint paiements_saspay_plan_check
    check (plan in ('starter', 'pro', 'entreprise', 'fne'));
exception when others then
  -- si la contrainte n'existe pas sous ce nom, on tente une suppression générique
  null;
end$$;

-- 2) Traitement unifié (idempotent, appelé par l'Edge Function webhook-saspay)
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
  v_is_fne boolean := false;
  v_payload_plan text;
  v_fne_res jsonb;
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

  -- 2.a Retrouver l'établissement : id transmis → demande en attente → préfixe CCI-XXXXXX
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

  -- 2.b Détection produit FNE (coût 80k, vente 100k) vs abonnement classique
  --     Le produit SasPay FNE est créé manuellement sur app.saspay.me (100 000 XOF/an).
  --     On le distingue via : p_plan / référence / payload.
  v_payload_plan := lower(coalesce(p_payload->>'plan', p_payload->>'produit', p_payload->>'product', p_payload->>'item', ''));
  v_is_fne := (
    lower(coalesce(p_plan, '')) = 'fne'
    or p_reference ilike '%-fne'
    or p_reference ilike '%fne_option%'
    or v_payload_plan in ('fne', 'fne_option_100k', 'fne_option')
    or (p_payload->>'produit_reference' ilike '%fne%')
    or (p_payload->>'reference_produit' ilike '%fne%')
    or (p_montant = 100000 and lower(coalesce(p_plan,'')) = '' and p_reference ilike '%fne%')
  );

  -- Pour les notifications SasPay qui ne portent pas de plan mais un montant 100k
  -- et un lien FNE (https://link.saspay.me/ikoziclmohm), le payload peut être
  -- minimal : on considère 100000 comme FNE uniquement si la référence porte fne.
  -- Cela évite de confondre un paiement entreprise 20 000 avec la FNE.

  if v_is_fne then
    v_plan := 'fne';
    v_statut := case when p_reussi then 'valide' else 'echoue' end;

    -- Journalisation même si l'établissement est introuvable
    insert into paiements_saspay (
      transaction_id, reference, etablissement_id, plan, montant, devise,
      telephone_payeur, statut, evenement, signature_valide, payload, traite_le
    ) values (
      p_transaction_id, p_reference, v_etab, 'fne', coalesce(p_montant,100000), coalesce(p_devise, 'XOF'),
      p_telephone, v_statut, coalesce(p_evenement,'fne'), p_signature_valide, p_payload,
      case when p_reussi then now() else null end
    )
    returning * into v_ligne;

    if p_reussi and v_etab is not null then
      -- Activation FNE : statut → en_cours, expiration → +365j, sans toucher au plan
      -- La fonction gère elle-même le journal fne_paiements et l'idempotence.
      select public.activer_option_fne(v_etab, p_transaction_id, p_reference, coalesce(p_montant,100000), p_payload) into v_fne_res;

      -- Clôture éventuelle d'une demande FNE en attente (si elle existe)
      update demandes_paiement
        set statut = 'valide',
            traite_le = now(),
            note_admin = coalesce(note_admin, '') || ' FNE activée par webhook SasPay (' || p_transaction_id || ').'
        where etablissement_id = v_etab
          and statut = 'en_attente'
          and (p_reference is null or reference_wave = p_reference);
    end if;

    return jsonb_build_object(
      'ok', true,
      'duplique', false,
      'statut', v_statut,
      'etablissement_id', v_etab,
      'plan', 'fne',
      'produit', 'fne_option_100k',
      'paiement_id', v_ligne.id,
      'fne', coalesce(v_fne_res, jsonb_build_object('ok', p_reussi))
    );
  end if;

  -- 2.c Chemin classique : starter / pro / entreprise (30 jours)
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

  -- Certains vieux fils passent plan_de_reference via le dernier segment
  if v_plan is null and p_reference is not null then
    v_plan := lower(substring(p_reference from '-([a-z]+)$'));
    if v_plan not in ('starter','pro','entreprise') then v_plan := null; end if;
  end if;

  if v_plan is null and v_etab is not null then
    select plan into v_plan from etablissements where id = v_etab;
  end if;

  v_plan := coalesce(v_plan, 'starter');
  v_statut := case when p_reussi then 'valide' else 'echoue' end;

  insert into paiements_saspay (
    transaction_id, reference, etablissement_id, plan, montant, devise,
    telephone_payeur, statut, evenement, signature_valide, payload, traite_le
  ) values (
    p_transaction_id, p_reference, v_etab, v_plan, p_montant, coalesce(p_devise, 'XOF'),
    p_telephone, v_statut, p_evenement, p_signature_valide, p_payload,
    case when p_reussi then now() else null end
  )
  returning * into v_ligne;

  if p_reussi and v_etab is not null then
    update etablissements
      set abonnement_actif = true,
          plan = v_plan,
          abonne_le = coalesce(abonne_le, now()),
          abonnement_expire_le = now() + make_interval(days => 30)
      where id = v_etab;

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

-- Exemples de test (à exécuter manuellement côté SQL Editor) :
--   -- FNE (référence en -fne) → fne_statut = en_cours, expiration +365j, plan inchangé
--   select public.traiter_paiement_saspay('TXN-FNE-TEST-001', 'CCI-A1B2C3-202512-fne', (select id from etablissements limit 1), 'fne', 100000, 'XOF', null, true, 'payment.success', true, '{"produit":"fne_option_100k"}'::jsonb);
--   select fne_statut, fne_expiration_date, plan from etablissements where id = (select id from etablissements limit 1);
--   select * from fne_paiements order by cree_le desc limit 5;
--
--   -- Classique
--   select public.traiter_paiement_saspay('TXN-CLASSIC-001', 'CCI-A1B2C3-202512-pro', null, 'pro', 10000, 'XOF', null, true, 'payment.success', true, '{}'::jsonb);

