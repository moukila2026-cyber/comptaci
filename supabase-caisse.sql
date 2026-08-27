create table if not exists sessions_caisse (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  ouverte_par uuid references auth.users not null,
  fond_ouverture numeric not null default 0,
  date_ouverture timestamp not null default now(),
  fond_fermeture_reel numeric,
  ecart numeric,
  date_fermeture timestamp,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'fermee'))
);

alter table sessions_caisse enable row level security;

create policy "acces_sessions_caisse_etablissement" on sessions_caisse
  for all using (est_membre_de(etablissement_id));
