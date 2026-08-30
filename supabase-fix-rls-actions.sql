-- ============================================================
-- CORRECTIF COMPTACI — Boutons inopérants après connexion (RLS)
-- ============================================================
-- À exécuter dans Supabase → SQL Editor (une seule fois, idempotent).
--
-- Problème corrigé :
--   Les tables transactions / produits / fournisseurs / sessions_caisse
--   n'avaient qu'une politique « for all » utilisant est_membre_de().
--   Or cette fonction ne vérifie que l'EXISTENCE d'une ligne dans
--   « membres » : elle est évaluée AVANT l'insertion. Le gérant qui se
--   connecte après avoir accepté une invitation pouvait donc se voir
--   refuser toutes les écritures (vente, dépense, stock, caisse,
--   fournisseurs) → les boutons « semblaient ne rien faire ».
--
--   Ce script sépare les politiques :
--     • SELECT : tous les membres du établissement (propriétaire ET gérant)
--     • INSERT / UPDATE / DELETE :
--         - le propriétaire (proprietaire_id = auth.uid())
--         - OU tout membre effectif de l'établissement
--   Le tout via des fonctions SECURITY DEFINER anti-récursion.
--
-- Il complète supabase-MASTER-COMPLET.sql sans rien casser.
-- ============================================================

-- ------------------------------------------------------------
-- Fonctions d'aide (SECURITY DEFINER => ne déclenchent pas la
-- récursion RLS sur la table « membres » / « etablissements »).
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

-- Droit d'écriture : propriétaire OU membre effectif de l'établissement.
create or replace function public.peut_ecrire_dans(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select public.est_proprietaire_de(etab_id) or public.est_membre_de(etab_id);
$$;

-- ------------------------------------------------------------
-- TRANSACTIONS (ventes / dépenses)
-- ------------------------------------------------------------
drop policy if exists "acces_transactions_etablissement" on transactions;
drop policy if exists "membres_voient_transactions" on transactions;
drop policy if exists "membres_ecrivent_transactions" on transactions;

create policy "membres_voient_transactions" on transactions
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ecrivent_transactions" on transactions
  for all using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

-- ------------------------------------------------------------
-- PRODUITS (stock)
-- ------------------------------------------------------------
drop policy if exists "acces_produits_etablissement" on produits;
drop policy if exists "membres_voient_produits" on produits;
drop policy if exists "membres_ecrivent_produits" on produits;

create policy "membres_voient_produits" on produits
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ecrivent_produits" on produits
  for all using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

-- ------------------------------------------------------------
-- FOURNISSEURS
-- ------------------------------------------------------------
drop policy if exists "acces_fournisseurs_etablissement" on fournisseurs;
drop policy if exists "membres_voient_fournisseurs" on fournisseurs;
drop policy if exists "membres_ecrivent_fournisseurs" on fournisseurs;

create policy "membres_voient_fournisseurs" on fournisseurs
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ecrivent_fournisseurs" on fournisseurs
  for all using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

-- ------------------------------------------------------------
-- SESSIONS DE CAISSE
-- ------------------------------------------------------------
drop policy if exists "acces_sessions_caisse_etablissement" on sessions_caisse;
drop policy if exists "membres_voient_sessions_caisse" on sessions_caisse;
drop policy if exists "membres_ecrivent_sessions_caisse" on sessions_caisse;

create policy "membres_voient_sessions_caisse" on sessions_caisse
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ecrivent_sessions_caisse" on sessions_caisse
  for all using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

-- ------------------------------------------------------------
-- MEMBRES : un gérant doit pouvoir lire SA propre ligne et celles
-- de son établissement (le propriétaire garde la main sur les
-- invitations via la politique proprietaire_gere_les_membres).
-- ------------------------------------------------------------
drop policy if exists "membre_voit_ses_etablissements" on membres;
drop policy if exists "membre_voit_membres_etablissement" on membres;

create policy "membre_voit_membres_etablissement" on membres
  for select using (
    user_id = auth.uid()
    or public.est_proprietaire_de(etablissement_id)
    or public.est_membre_de(etablissement_id)
  );

-- ------------------------------------------------------------
-- INSCRIPTION PROPRIÉTAIRE : création automatique de la ligne
-- « membres » correspondante.
--
-- Sans ce déclencheur, l'inscription bute sur un problème circulaire :
--   • la politique SELECT des établissements exige d'être déjà membre
--     (est_membre_de) pour relire l'établissement qui vient d'être créé ;
--   • or la ligne « membres » n'est insérée qu'APRÈS, par l'application,
--     et son insertion est elle-même filtrée par les politiques RLS.
-- Résultat : le clic sur « Créer mon compte » échouait / semblait mort.
--
-- Le déclencheur crée le membre propriétaire avec les privilèges du
-- propriétaire de la base (SECURITY DEFINER => ignore la RLS), au sein
-- de la même transaction que l'INSERT de l'établissement.
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
-- Fin du correctif.
-- Après exécution :
--   • l'inscription d'un établissement fonctionne (membre propriétaire
--     créé automatiquement) ;
--   • propriétaires ET gérants peuvent saisir des ventes/dépenses,
--     gérer le stock, les fournisseurs et la caisse ;
--   • les boutons qui « ne faisaient rien » après connexion fonctionnent.
-- ============================================================
