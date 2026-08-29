create table if not exists fournisseurs (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  nom text not null,
  telephone text not null,
  note text,
  cree_le timestamp default now()
);

alter table fournisseurs enable row level security;

drop policy if exists "acces_fournisseurs_etablissement" on fournisseurs;
create policy "acces_fournisseurs_etablissement" on fournisseurs
  for all using (est_membre_de(etablissement_id));
