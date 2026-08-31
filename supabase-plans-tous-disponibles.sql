-- ------------------------------------------------------------
-- ComptaCi — Tous les plans disponibles (Starter, Pro, Entreprise)
--
-- Nouvelle règle de gestion : les 3 forfaits sont proposés à TOUS
-- les établissements, fondateurs compris. L'offre Fondateurs ne
-- verrouille plus que le TARIF du plan Starter (7 000 FCFA/mois à vie) ;
-- Pro (10 000 FCFA/mois) et Entreprise (20 000 FCFA/mois) restent
-- souscriptibles au tarif officiel, pour tout le monde.
--
-- À exécuter dans le SQL Editor Supabase (idempotent, sans danger).
-- ------------------------------------------------------------

-- 1) Supprime le garde-fou qui ramenait tout établissement fondateur
--    sur le plan STARTER à chaque mise à jour (trigger BEFORE UPDATE).
drop trigger if exists trg_fondateur_plan_starter on etablissements;
drop function if exists public.empecher_sortie_plan_fondateur();

-- 2) Supprime le verrou qui forçait les demandes de paiement des
--    fondateurs vers le plan STARTER / 7 000 FCFA.
drop trigger if exists trg_demandes_paiement_fondateur on demandes_paiement;
drop function if exists public.forcer_plan_fondateur_demande();

-- 3) Aucune donnée n'est corrigée : un fondateur déjà sur Starter y
--    reste ; un fondateur déjà passé sur Pro/Entreprise n'est plus
--    ramené en arrière. `valider_paiement()` applique désormais
--    directement le plan demandé dans la déclaration de paiement.

-- Vérification (aucun fondateur ne doit être re-verrouillé à l'avenir) :
--   select tgname, tgenabled
--     from pg_trigger
--    where tgname in ('trg_fondateur_plan_starter', 'trg_demandes_paiement_fondateur');
