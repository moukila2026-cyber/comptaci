-- ------------------------------------------------------------
-- ComptaCi — Tous les plans disponibles (Starter, Pro, Entreprise)
-- à la fin des 7 jours d'essai, fondateurs compris
--
-- Règle appliquée :
--   • Pendant l'essai (7 j) : un fondateur reste sur STARTER.
--   • À la fin de l'essai : Starter, Pro et Entreprise sont affichés
--     et souscriptibles, y compris pour les fondateurs.
--   • Seul le tarif du plan Starter reste verrouillé à vie
--     (7 000 FCFA/mois, colonne tarif_verrouille).
--
-- Ce script est IDEMPOTENT et SANS DANGER : à exécuter dans le
-- SQL Editor Supabase. Il supprime les deux verrous SQL qui
-- ramenaient automatiquement les fondateurs sur le plan Starter.
-- ------------------------------------------------------------

-- 1) Supprime le garde-fou qui ramenait tout établissement fondateur
--    sur le plan STARTER à chaque mise à jour (trigger BEFORE UPDATE).
drop trigger if exists trg_fondateur_plan_starter on etablissements;
drop function if exists public.empecher_sortie_plan_fondateur();

-- 2) Supprime le verrou qui forçait les demandes de paiement des
--    fondateurs vers le plan STARTER / 7 000 FCFA (trigger BEFORE INSERT).
drop trigger if exists trg_demandes_paiement_fondateur on demandes_paiement;
drop function if exists public.forcer_plan_fondateur_demande();

-- 3) Vérification automatique : signale un problème si un verrou
--    est encore présent, confirme sinon.
do $$
declare
  nb_verrous int;
begin
  select count(*) into nb_verrous
    from pg_trigger
   where tgname in ('trg_fondateur_plan_starter', 'trg_demandes_paiement_fondateur')
     and not tgisinternal;

  if nb_verrous > 0 then
    raise exception 'Il reste % verrou(s) fondateur : les triggers n''ont pas été supprimés, vérifie le script.', nb_verrous;
  end if;

  raise notice 'OK — verrous fondateur supprimés : Pro et Entreprise sont désormais opérationnels pour les fondateurs (après l''essai de 7 jours).';
end;
$$;

-- 4) Contrôles manuels (facultatifs, à copier-coller séparément si besoin)

--    a) Aucun trigger de verrouillage ne doit apparaître :
--       select tgname from pg_trigger
--        where tgname in ('trg_fondateur_plan_starter', 'trg_demandes_paiement_fondateur')
--          and not tgisinternal;

--    b) Aucun fondateur ne doit être re-verrouillé :
--       select id, nom, plan, tarif_verrouille from etablissements
--        where est_fondateur = true
--          and (plan not in ('starter','pro','entreprise') or tarif_verrouille <> 7000);

--    c) Places restantes sur l'offre Fondateurs :
--       select public.places_fondateurs_restantes();
