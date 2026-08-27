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
