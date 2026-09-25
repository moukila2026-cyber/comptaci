-- ============================================================================
--  ComptaCi — Option FNE via KOMPTO (intégrateur FNE agréé DGI)
--  À exécuter dans Supabase → SQL Editor. 100 % idempotent, non destructif.
--
--  Ce script complète `supabase-fne.sql` (à exécuter AVANT, il crée la table
--  `factures_fne`). Il ajoute :
--
--   1. le cycle de vie FNE par établissement : `fne_statut` (aucune /
--      en_cours / active) + `fne_expiration_date`, l'arbre de décision
--      (`fne_compte_dgi`, `fne_choix`) et les identifiants KOMPTO
--      (`fne_establishment`, `fne_point_of_sale`, `fne_ncc`) ;
--   2. `abonnements_fne` : l'option annuelle 100 000 FCFA par établissement ;
--   3. `factures_fne` étendue : `kompto_entry_id` (indispensable aux avoirs),
--      numéro fiscal, certificat, type facture/avoir ;
--   4. `appels_fne_kompto` : piste d'audit des appels à l'API ;
--   5. les RPC `activer_option_fne` (idempotente, appelée par le webhook
--      SasPay) et `enregistrer_choix_fne` (écran de configuration) ;
--   6. la RLS associée.
--
--  ── PRINCIPE COMMERCIAL : RIEN N'EST CASSÉ SUR LES PLANS EXISTANTS ────────
--  Ce script NE MODIFIE AUCUN tarif de forfait. Starter/Fondateur 7 000,
--  Pro 10 000, Entreprise 20 000 FCFA/mois restent tels quels, et les
--  colonnes `plan`, `est_fondateur`, `tarif_verrouille` ne sont pas touchées.
--  La FNE est une OPTION SÉPARÉE, stockée dans ses propres colonnes et sa
--  propre table, disponible sur TOUS les plans y compris Fondateur.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cycle de vie FNE + identifiants KOMPTO sur l'établissement
-- ---------------------------------------------------------------------------

-- Question 1 : « Avez-vous déjà un compte FNE actif auprès de la DGI ? »
alter table etablissements
  add column if not exists fne_compte_dgi text;

alter table etablissements
  drop constraint if exists etablissements_fne_compte_dgi_check;
alter table etablissements
  add constraint etablissements_fne_compte_dgi_check
  check (fne_compte_dgi is null or fne_compte_dgi in ('oui', 'non'));

-- Question 2 : le choix final de l'établissement.
--   compte « non » → creer | sans_fne
--   compte « oui » → connecter | methode_actuelle
alter table etablissements
  add column if not exists fne_choix text;

alter table etablissements
  drop constraint if exists etablissements_fne_choix_check;
alter table etablissements
  add constraint etablissements_fne_choix_check
  check (fne_choix is null or fne_choix in ('creer', 'connecter', 'sans_fne', 'methode_actuelle'));

-- Statut de l'option : aucune / en_cours / active.
alter table etablissements
  add column if not exists fne_statut text not null default 'aucune';

alter table etablissements
  drop constraint if exists etablissements_fne_statut_check;
alter table etablissements
  add constraint etablissements_fne_statut_check
  check (fne_statut in ('aucune', 'en_cours', 'active'));

-- Échéance annuelle de l'option (facturée d'avance).
alter table etablissements
  add column if not exists fne_expiration_date date;

-- Les trois identifiants exigés par le cahier des charges.
alter table etablissements
  add column if not exists fne_establishment text;
alter table etablissements
  add column if not exists fne_point_of_sale text;
alter table etablissements
  add column if not exists fne_ncc text;

-- Environnement KOMPTO : on démarre en sandbox avant la production.
alter table etablissements
  add column if not exists fne_environnement text not null default 'sandbox';

alter table etablissements
  drop constraint if exists etablissements_fne_environnement_check;
alter table etablissements
  add constraint etablissements_fne_environnement_check
  check (fne_environnement in ('sandbox', 'production'));

comment on column etablissements.fne_compte_dgi is
  'Question 1 : le commerçant a-t-il déjà un compte FNE actif auprès de la DGI ? (oui/non)';
comment on column etablissements.fne_choix is
  'Question 2 : creer | connecter (option payante via KOMPTO) ; sans_fne | methode_actuelle (aucun coût, pas de lien FNE).';
comment on column etablissements.fne_statut is
  'Cycle de vie de l''option FNE : aucune, en_cours, active.';
comment on column etablissements.fne_expiration_date is
  'Échéance de l''option annuelle FNE (100 000 FCFA/an, facturée d''avance).';
comment on column etablissements.fne_establishment is
  'Identifiant KOMPTO « establishment » de l''établissement.';
comment on column etablissements.fne_point_of_sale is
  'Identifiant KOMPTO « pointOfSale » du point de vente.';
comment on column etablissements.fne_ncc is
  'Numéro de Compte Contribuable (NCC) de l''établissement émetteur.';
comment on column etablissements.fne_environnement is
  'Environnement KOMPTO : sandbox (qa.kompto.com) ou production (app.kompto.com).';

-- Reprise des données issues de `supabase-fne.sql` (si ce script a été joué).
-- ⚠️ Ces colonnes n'existent QUE si `supabase-fne.sql` a déjà été exécuté.
-- On les teste donc dynamiquement : sur une base neuve, la reprise est
-- simplement ignorée au lieu de faire avorter toute la migration.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'etablissements'
       and column_name = 'fne_active'
  ) then
    -- Un établissement déjà marqué actif avec ses identifiants DGI passe en
    -- « en_cours », PAS en « active » : l'option payante annuelle n'a jamais
    -- été souscrite à l'époque.
    execute $sql$
      update etablissements
         set fne_statut = 'en_cours',
             fne_choix  = coalesce(fne_choix, 'connecter'),
             fne_compte_dgi = coalesce(fne_compte_dgi, 'oui')
       where (fne_active = true or fne_cle_api is not null)
         and fne_statut = 'aucune'
         and fne_choix is null
    $sql$;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'etablissements'
       and column_name = 'fne_numero_contribuable'
  ) then
    -- Le NCC DGI saisi dans l'ancien champ `fne_numero_contribuable` est le
    -- même identifiant que `fne_ncc` : on le reprend pour ne rien ressaisir.
    execute $sql$
      update etablissements
         set fne_ncc = fne_numero_contribuable
       where fne_ncc is null
         and fne_numero_contribuable is not null
    $sql$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Option annuelle FNE : 100 000 FCFA/an/établissement
-- ---------------------------------------------------------------------------
-- Table DISTINCTE de `demandes_paiement` et de `paiements_saspay`, qui portent
-- les forfaits mensuels. Aucune colonne de tarif de forfait n'est modifiée :
-- les plans existants restent strictement inchangés.

create table if not exists abonnements_fne (
  id                 uuid primary key default gen_random_uuid(),
  etablissement_id   uuid not null references etablissements (id) on delete cascade,
  transaction_id     text unique,          -- référence SasPay (idempotence)
  reference          text,
  montant            numeric(12, 2) not null default 100000,
  cout_kompto        numeric(12, 2) not null default 80000,
  devise             text not null default 'XOF',
  periode_debut      date not null default current_date,
  periode_fin        date not null,
  statut             text not null default 'actif'
                       check (statut in ('actif', 'expire', 'annule', 'rembourse')),
  moyen_paiement     text,
  telephone_payeur   text,
  cree_le            timestamptz not null default now()
);

create index if not exists idx_abonnements_fne_etab
  on abonnements_fne (etablissement_id, periode_fin desc);
create index if not exists idx_abonnements_fne_reference
  on abonnements_fne (reference);

comment on table abonnements_fne is
  'Option FNE annuelle (100 000 FCFA/an/établissement), facturée d''avance. Indépendante des forfaits mensuels : les tarifs des plans ne sont pas modifiés.';
comment on column abonnements_fne.transaction_id is
  'Référence unique du paiement SasPay : garantit qu''un même paiement n''active jamais l''option deux fois.';
comment on column abonnements_fne.cout_kompto is
  'Coût réel KOMPTO (80 000 FCFA/an). La marge ComptaCi est la différence avec `montant`, soit 20 000 FCFA/an.';

-- Verrou de cohérence : la période doit couvrir au moins l'année payée.
alter table abonnements_fne
  drop constraint if exists abonnements_fne_periode_coherente;
alter table abonnements_fne
  add constraint abonnements_fne_periode_coherente
  check (periode_fin > periode_debut);

-- Lisible uniquement par les membres de l'établissement.
alter table abonnements_fne enable row level security;

drop policy if exists "abonnements_fne_lecture_membres" on abonnements_fne;
create policy "abonnements_fne_lecture_membres"
  on abonnements_fne for select
  using (exists (
    select 1 from membres m
     where m.etablissement_id = abonnements_fne.etablissement_id
       and m.user_id = auth.uid()
  ));

-- Aucune politique INSERT/UPDATE côté client : l'activation passe par la RPC
-- `activer_option_fne` (SECURITY DEFINER), appelée par le webhook de paiement.
-- Un client ne peut donc pas s'auto-activer l'option sans payer.

-- ---------------------------------------------------------------------------
-- 3. `factures_fne` étendue pour le cycle KOMPTO
-- ---------------------------------------------------------------------------

-- ⚠️ `kompto_entry_id` est LE champ critique du dispositif : il est renvoyé
-- par /verify et doit être stocké IMMÉDIATEMENT. Sans lui, aucun /confirm,
-- aucune récupération, aucune annulation et surtout AUCUN avoir n'est possible
-- sur une facture déjà confirmée (document légal irréversible).
alter table factures_fne
  add column if not exists kompto_entry_id text;

alter table factures_fne
  add column if not exists numero_fiscal text;
alter table factures_fne
  add column if not exists certificat jsonb;
alter table factures_fne
  add column if not exists environnement text not null default 'sandbox';
alter table factures_fne
  add column if not exists type_document text not null default 'facture';
alter table factures_fne
  add column if not exists avoir_de uuid references factures_fne (id) on delete set null;
alter table factures_fne
  add column if not exists client_type text;
alter table factures_fne
  add column if not exists client_nom text;
alter table factures_fne
  add column if not exists client_ncc text;
alter table factures_fne
  add column if not exists mode_paiement text;
alter table factures_fne
  add column if not exists payload_verifie jsonb;
alter table factures_fne
  add column if not exists confirme_le timestamptz;
alter table factures_fne
  add column if not exists annule_le timestamptz;

-- Un même `kompto_entry_id` ne doit jamais apparaître deux fois : ce serait le
-- signe d'un double envoi à la DGI.
create unique index if not exists factures_fne_kompto_entry_id_unique
  on factures_fne (kompto_entry_id)
  where kompto_entry_id is not null;

create index if not exists idx_factures_fne_numero_fiscal
  on factures_fne (numero_fiscal);
create index if not exists idx_factures_fne_avoir_de
  on factures_fne (avoir_de);

-- Extension du statut : l'ancienne contrainte ne connaissait que
-- brouillon / certifiee / refusee, qui ne couvrent pas le cycle KOMPTO.
alter table factures_fne
  drop constraint if exists factures_fne_statut_check;
alter table factures_fne
  add constraint factures_fne_statut_check
  check (statut in (
    'brouillon',    -- générée localement, rien d'envoyé
    'verifiee',     -- /verify réussi, kompto_entry_id obtenu, PAS encore soumise
    'confirmee',    -- /confirm réussi : FNE officielle, IRRÉVERSIBLE
    'certifiee',    -- alias historique conservé pour les lignes existantes
    'annulee',      -- /delete avant confirmation
    'avoir',        -- /createCreditNote sur une facture confirmée
    'refusee',      -- rejet KOMPTO/DGI
    'erreur'        -- échec technique (réseau, timeout…)
  ));

alter table factures_fne
  drop constraint if exists factures_fne_type_document_check;
alter table factures_fne
  add constraint factures_fne_type_document_check
  check (type_document in ('facture', 'avoir'));

alter table factures_fne
  drop constraint if exists factures_fne_environnement_check;
alter table factures_fne
  add constraint factures_fne_environnement_check
  check (environnement in ('sandbox', 'production'));

comment on column factures_fne.kompto_entry_id is
  'Identifiant KOMPTO renvoyé par /verify. À stocker immédiatement : requis pour /confirm, /delete, /getVerify, /getElectronicInvoice et /createCreditNote.';
comment on column factures_fne.numero_fiscal is
  'Numéro de la FNE attribué par la DGI lors du /confirm (série annuelle ininterrompue).';
comment on column factures_fne.certificat is
  'Certificat fiscal / sticker électronique renvoyé par /confirm : visuel FNE, QR code, URL du PDF.';
comment on column factures_fne.environnement is
  'sandbox = facture de test SANS valeur fiscale ; production = document légal.';
comment on column factures_fne.avoir_de is
  'Pour un avoir : la facture confirmée qu''il corrige.';
comment on column factures_fne.payload_verifie is
  'Données brutes envoyées à /verify (aucun montant calculé : KOMPTO et la DGI calculent tout).';

-- ---------------------------------------------------------------------------
-- 4. Piste d'audit des appels à l'API KOMPTO
-- ---------------------------------------------------------------------------

create table if not exists appels_fne_kompto (
  id                uuid primary key default gen_random_uuid(),
  etablissement_id  uuid references etablissements (id) on delete cascade,
  user_id           uuid references auth.users (id) on delete set null,
  action            text not null,
  environnement     text not null default 'sandbox',
  statut_http       integer,
  reussi            boolean not null default false,
  erreur            text,
  duree_ms          integer,
  kompto_entry_id   text,
  appele_le         timestamptz not null default now()
);

create index if not exists idx_appels_fne_kompto_etab
  on appels_fne_kompto (etablissement_id, appele_le desc);
create index if not exists idx_appels_fne_kompto_entry
  on appels_fne_kompto (kompto_entry_id);

comment on table appels_fne_kompto is
  'Journal des appels à l''API KOMPTO. Le payload n''est JAMAIS journalisé : il contient des données clients.';

-- Accessible en lecture aux membres (diagnostic), en écriture au service_role
-- uniquement (c'est la fonction Edge qui journalise).
alter table appels_fne_kompto enable row level security;

drop policy if exists "appels_fne_kompto_lecture_membres" on appels_fne_kompto;
create policy "appels_fne_kompto_lecture_membres"
  on appels_fne_kompto for select
  using (exists (
    select 1 from membres m
     where m.etablissement_id = appels_fne_kompto.etablissement_id
       and m.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 5. RPC `activer_option_fne` — activation annuelle, IDEMPOTENTE
-- ---------------------------------------------------------------------------
-- Appelée par le webhook de paiement SasPay. Un même `transaction_id` ne peut
-- activer l'option qu'une seule fois : un rejeu de notification est sans effet.

create or replace function public.activer_option_fne(
  p_etablissement_id uuid,
  p_transaction_id   text default null,
  p_reference        text default null,
  p_montant          numeric default 100000,
  p_cout_kompto      numeric default 80000,
  p_moyen_paiement   text default null,
  p_telephone        text default null,
  p_duree_mois       integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_etab          record;
  v_deja          uuid;
  v_base          date;
  v_fin           date;
  v_statut        text;
  v_identifiants  boolean;
begin
  if p_etablissement_id is null then
    return jsonb_build_object('ok', false, 'raison', 'etablissement_manquant');
  end if;

  select id, fne_choix, fne_statut, fne_expiration_date,
         fne_establishment, fne_point_of_sale, fne_ncc
    into v_etab
    from etablissements
   where id = p_etablissement_id;

  if not found then
    return jsonb_build_object('ok', false, 'raison', 'etablissement_introuvable');
  end if;

  -- IDEMPOTENCE : ce paiement a déjà été traité.
  if p_transaction_id is not null then
    select id into v_deja from abonnements_fne where transaction_id = p_transaction_id;
    if v_deja is not null then
      return jsonb_build_object(
        'ok', true, 'deja_traite', true, 'abonnement_fne_id', v_deja,
        'fne_expiration_date', v_etab.fne_expiration_date
      );
    end if;
  end if;

  -- Facturation D'AVANCE pour 12 mois. Un renouvellement anticipé s'ajoute à
  -- l'échéance en cours : le commerçant ne perd pas les jours déjà payés.
  -- Un renouvellement après expiration repart d'aujourd'hui.
  v_base := case
              when v_etab.fne_expiration_date is not null
               and v_etab.fne_expiration_date >= current_date
              then v_etab.fne_expiration_date
              else current_date
            end;
  v_fin := (v_base + make_interval(months => coalesce(p_duree_mois, 12)))::date;

  insert into abonnements_fne (
    etablissement_id, transaction_id, reference, montant, cout_kompto,
    periode_debut, periode_fin, statut, moyen_paiement, telephone_payeur
  ) values (
    p_etablissement_id, p_transaction_id, p_reference,
    coalesce(p_montant, 100000), coalesce(p_cout_kompto, 80000),
    current_date, v_fin, 'actif', p_moyen_paiement, p_telephone
  );

  -- Le statut ne passe à « active » que si les identifiants KOMPTO sont
  -- complets. Un paiement reçu sur un choix « connecter » dont le formulaire
  -- n'est pas encore rempli crédite bien l'année payée, mais reste « en_cours »
  -- : sans establishment / pointOfSale / NCC, KOMPTO ne peut rien certifier.
  v_identifiants := coalesce(v_etab.fne_establishment, '') <> ''
                and coalesce(v_etab.fne_point_of_sale, '') <> ''
                and coalesce(v_etab.fne_ncc, '') <> '';

  v_statut := case when v_identifiants then 'active' else 'en_cours' end;

  update etablissements
     set fne_statut          = v_statut,
         fne_expiration_date = v_fin,
         -- Un établissement payé n'a plus de raison de rester sur un choix
         -- « sans FNE » : on l'aligne sur « connecter » s'il n'a rien choisi.
         fne_choix           = coalesce(nullif(v_etab.fne_choix, ''), 'connecter')
   where id = p_etablissement_id;

  return jsonb_build_object(
    'ok', true,
    'deja_traite', false,
    'fne_statut', v_statut,
    'fne_expiration_date', v_fin,
    'identifiants_complets', v_identifiants,
    'montant', coalesce(p_montant, 100000),
    'cout_kompto', coalesce(p_cout_kompto, 80000),
    'marge', coalesce(p_montant, 100000) - coalesce(p_cout_kompto, 80000)
  );
end;
$$;

-- Ni `anon` ni `authenticated` : SEUL le service_role (la fonction Edge, après
-- vérification du paiement) peut activer l'option. Un client ne peut pas
-- s'auto-activer la FNE sans payer.
revoke all on function public.activer_option_fne(uuid, text, text, numeric, numeric, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.activer_option_fne(uuid, text, text, numeric, numeric, text, text, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. RPC `enregistrer_choix_fne` — écran de configuration par établissement
-- ---------------------------------------------------------------------------
-- Réservée au PROPRIÉTAIRE : le choix FNE engage l'établissement fiscalement
-- et financièrement (100 000 FCFA/an), un gérant ne peut pas le prendre seul.

create or replace function public.enregistrer_choix_fne(
  p_etablissement_id uuid,
  p_compte_dgi       text,
  p_choix            text,
  p_establishment    text default null,
  p_point_of_sale    text default null,
  p_ncc              text default null,
  p_environnement    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_etab        record;
  v_choix       text := lower(coalesce(p_choix, ''));
  v_compte      text := lower(coalesce(p_compte_dgi, ''));
  v_payant      boolean;
  v_statut      text;
  v_identifiants boolean;
  v_option_valide boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'raison', 'authentification_requise');
  end if;

  select id, proprietaire_id, fne_statut, fne_expiration_date
    into v_etab
    from etablissements
   where id = p_etablissement_id;

  if not found then
    return jsonb_build_object('ok', false, 'raison', 'etablissement_introuvable');
  end if;

  if v_etab.proprietaire_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'raison', 'reserve_au_proprietaire');
  end if;

  if v_compte not in ('oui', 'non') then
    return jsonb_build_object('ok', false, 'raison', 'compte_dgi_invalide');
  end if;

  -- Cohérence de l'arbre de décision : les secondes options dépendent de la
  -- réponse à la question 1.
  if v_compte = 'oui' and v_choix not in ('connecter', 'methode_actuelle') then
    return jsonb_build_object('ok', false, 'raison', 'choix_incoherent_avec_compte_oui');
  end if;
  if v_compte = 'non' and v_choix not in ('creer', 'sans_fne') then
    return jsonb_build_object('ok', false, 'raison', 'choix_incoherent_avec_compte_non');
  end if;

  v_payant := v_choix in ('creer', 'connecter');

  -- L'option est-elle déjà payée et non expirée ?
  select (v_etab.fne_expiration_date is not null
          and v_etab.fne_expiration_date >= current_date)
    into v_option_valide;

  -- « creer » et « connecter » démarrent à « en_cours » : le parcours KOMPTO
  -- est lancé, mais l'option n'est ni payée ni opérationnelle.
  -- Les deux autres choix restent à « aucune » : établissement géré normalement
  -- dans ComptaCi, sans facturation certifiée et sans aucun coût.
  v_statut := case when v_payant then 'en_cours' else 'aucune' end;

  -- On ne rétrograde jamais un établissement déjà « active » dont l'option est
  -- payée : il garde son droit jusqu'à l'échéance.
  if v_payant and v_etab.fne_statut = 'active' and coalesce(v_option_valide, false) then
    v_statut := 'active';
  end if;

  v_identifiants := coalesce(nullif(trim(p_establishment), ''), '') <> ''
                and coalesce(nullif(trim(p_point_of_sale), ''), '') <> ''
                and coalesce(nullif(trim(p_ncc), ''), '') <> '';

  -- Le statut « active » exige à la fois l'option payée ET les identifiants.
  if v_statut = 'active' and not v_identifiants then
    v_statut := 'en_cours';
  end if;

  update etablissements
     set fne_compte_dgi    = v_compte,
         fne_choix         = v_choix,
         fne_statut        = v_statut,
         fne_establishment = coalesce(nullif(trim(p_establishment), ''), fne_establishment),
         fne_point_of_sale = coalesce(nullif(trim(p_point_of_sale), ''), fne_point_of_sale),
         fne_ncc           = coalesce(nullif(trim(p_ncc), ''), fne_ncc),
         fne_environnement = coalesce(
                               case when lower(coalesce(p_environnement, '')) in ('sandbox', 'production')
                                    then lower(p_environnement) end,
                               fne_environnement),
         -- Un choix sans FNE remet l'échéance à null : plus d'option en cours.
         fne_expiration_date = case when v_payant then fne_expiration_date else null end
   where id = p_etablissement_id;

  return jsonb_build_object(
    'ok', true,
    'fne_choix', v_choix,
    'fne_statut', v_statut,
    'option_payante', v_payant,
    'identifiants_complets', v_identifiants,
    -- Ce que l'écran doit faire ensuite : proposer le paiement, ou lancer le
    -- parcours d'enregistrement KOMPTO, ou simplement confirmer.
    'prochaine_etape', case
      when not v_payant then 'rien_a_payer'
      when not coalesce(v_option_valide, false) then 'payer_option'
      when not v_identifiants then 'renseigner_identifiants'
      else 'operationnel'
    end
  );
end;
$$;

revoke all on function public.enregistrer_choix_fne(uuid, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.enregistrer_choix_fne(uuid, text, text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC `archiver_facture_fne` — écriture du kompto_entry_id dès /verify
-- ---------------------------------------------------------------------------
-- Le stockage du `kompto_entry_id` doit être IMMÉDIAT après /verify : c'est la
-- seule référence permettant ensuite /confirm, /delete et /createCreditNote.
-- Un appel réseau qui tombe entre /verify et l'archivage ferait perdre une
-- facture déjà enregistrée côté KOMPTO — d'où cette RPC atomique.

create or replace function public.archiver_facture_fne(
  p_etablissement_id  uuid,
  p_transaction_id    uuid default null,
  p_numero            text default null,
  p_statut            text default 'verifiee',
  p_kompto_entry_id   text default null,
  p_environnement     text default 'sandbox',
  p_type_document     text default 'facture',
  p_client_type       text default null,
  p_client_nom        text default null,
  p_client_ncc        text default null,
  p_mode_paiement     text default null,
  p_lignes            jsonb default '[]'::jsonb,
  p_payload_verifie   jsonb default null,
  p_numero_fiscal     text default null,
  p_certificat        jsonb default null,
  p_avoir_de          uuid default null,
  p_erreur            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_exist   uuid;
  v_ligne   record;
begin
  if p_etablissement_id is null then
    return jsonb_build_object('ok', false, 'raison', 'etablissement_manquant');
  end if;

  -- Idempotence sur le kompto_entry_id : un rejeu ne crée pas de doublon,
  -- il met à jour la ligne existante (passage verifiee → confirmee, etc.).
  if p_kompto_entry_id is not null then
    select id into v_exist
      from factures_fne
     where kompto_entry_id = p_kompto_entry_id
       and etablissement_id = p_etablissement_id;
  end if;

  if v_exist is not null then
    update factures_fne
       set statut          = coalesce(p_statut, statut),
           numero          = coalesce(p_numero, numero),
           numero_fiscal   = coalesce(p_numero_fiscal, numero_fiscal),
           certificat      = coalesce(p_certificat, certificat),
           payload_verifie = coalesce(p_payload_verifie, payload_verifie),
           erreur_dgi      = coalesce(p_erreur, erreur_dgi),
           confirme_le     = case when p_statut = 'confirmee' then now() else confirme_le end,
           annule_le       = case when p_statut = 'annulee' then now() else annule_le end
     where id = v_exist
    returning id into v_id;

    return jsonb_build_object('ok', true, 'facture_fne_id', v_id, 'mis_a_jour', true);
  end if;

  insert into factures_fne (
    etablissement_id, transaction_id, numero, statut,
    date_emission, montant_ht, tva, montant_ttc, lignes,
    kompto_entry_id, environnement, type_document, avoir_de,
    client_type, client_nom, client_ncc, mode_paiement,
    payload_verifie, numero_fiscal, certificat, erreur_dgi,
    confirme_le, conserve_jusqua
  ) values (
    p_etablissement_id, p_transaction_id,
    coalesce(p_numero, 'FNE-' || to_char(now(), 'YYYY') || '-' ||
             lpad(floor(random() * 1000000)::text, 6, '0')),
    coalesce(p_statut, 'verifiee'),
    current_date, 0, 0, 0,
    coalesce(p_lignes, '[]'::jsonb),
    p_kompto_entry_id, coalesce(p_environnement, 'sandbox'),
    coalesce(p_type_document, 'facture'), p_avoir_de,
    p_client_type, p_client_nom, p_client_ncc, p_mode_paiement,
    p_payload_verifie, p_numero_fiscal, p_certificat, p_erreur,
    case when p_statut = 'confirmee' then now() end,
    -- Archivage légal : 10 ans.
    (current_date + interval '10 years')::date
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'facture_fne_id', v_id, 'mis_a_jour', false);
end;
$$;

revoke all on function public.archiver_facture_fne(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, text, jsonb, uuid, text
) from public, anon;
grant execute on function public.archiver_facture_fne(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, text, jsonb, uuid, text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Vérification
-- ---------------------------------------------------------------------------
-- select fne_choix, fne_statut, count(*) from etablissements group by 1, 2;
-- select count(*) as options_actives from etablissements
--  where fne_statut = 'active' and fne_expiration_date >= current_date;
-- select sum(montant) as ca_fne, sum(montant - cout_kompto) as marge_fne
--   from abonnements_fne where statut = 'actif';
-- select statut, type_document, environnement, count(*)
--   from factures_fne group by 1, 2, 3;
