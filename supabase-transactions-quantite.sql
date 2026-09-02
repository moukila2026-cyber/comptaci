-- ============================================================
-- COMPTACI — MIGRATION : quantité sur les mouvements
-- ============================================================
-- À exécuter UNE FOIS dans Supabase → SQL Editor (idempotent).
--
-- Pourquoi ?
--   Le tableau de bord classe désormais les « produits les plus
--   vendus du mois » (quantités écoulées, CA généré, part du CA)
--   et l'onglet Stock valorise chaque référence en FCFA. Pour
--   cela, chaque mouvement doit connaître sa quantité.
--
-- Sans cette migration, l'application continue de fonctionner :
-- elle relit alors la quantité dans la note (« Qté: 12 »).
-- ============================================================

alter table transactions add column if not exists quantite numeric default 0;

-- Rattrapage de l'historique : on relit la quantité déjà écrite
-- dans la note au format « Désignation — Qté: 12 — PU: 2 000 FCFA ».
update transactions
   set quantite = replace((regexp_match(note, 'Qté\s*:\s*([0-9]+(?:[.,][0-9]+)?)'))[1], ',', '.')::numeric
 where (quantite is null or quantite = 0)
   and note ~ 'Qté\s*:\s*([0-9]+([.,][0-9]+)?)';
