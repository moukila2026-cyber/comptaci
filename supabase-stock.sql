-- ============================================================
-- ATTENTION — ANCIEN SCRIPT, NE PAS RELANCER.
-- Il recrée des politiques qui permettent aux gérants d'écrire dans le stock,
-- les mouvements ou les fournisseurs. Utiliser supabase-SETUP-FINAL.sql.
-- Si ce script a déjà été relancé, exécuter ensuite
-- supabase-stock-proprietaire.sql (voir LISEZ-MOI-CORRECTIONS.md).
-- ============================================================
create table if not exists produits (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  designation text not null,
  quantite_stock numeric not null default 0,
  prix_unitaire numeric,
  maj_le timestamp default now(),
  unique (etablissement_id, designation)
);

alter table produits enable row level security;

create policy "acces_produits_etablissement" on produits
  for all using (est_membre_de(etablissement_id));
