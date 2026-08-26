-- Code d'invitation unique par établissement, pour que le propriétaire
-- puisse inviter un gérant sans exposer d'informations sensibles.
alter table etablissements add column if not exists code_invitation text unique;

update etablissements
set code_invitation = upper(substr(md5(random()::text), 1, 6))
where code_invitation is null;

alter table etablissements alter column code_invitation set default upper(substr(md5(random()::text), 1, 6));

-- Table des membres : qui a accès à quel établissement, avec quel rôle.
create table if not exists membres (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  user_id uuid references auth.users not null,
  role text not null default 'gerant' check (role in ('proprietaire', 'gerant')),
  cree_le timestamp default now(),
  unique (etablissement_id, user_id)
);

alter table membres enable row level security;

create policy "membre_voit_ses_etablissements" on membres
  for select using (user_id = auth.uid());

create policy "proprietaire_gere_les_membres" on membres
  for all using (
    etablissement_id in (select id from etablissements where proprietaire_id = auth.uid())
  );

-- Le propriétaire est automatiquement membre avec le rôle 'proprietaire'
insert into membres (etablissement_id, user_id, role)
select id, proprietaire_id, 'proprietaire' from etablissements
on conflict (etablissement_id, user_id) do nothing;

-- Élargir l'accès aux transactions : plus seulement le propriétaire,
-- mais tout membre (propriétaire ou gérant) de l'établissement.
drop policy if exists "acces_transactions_etablissement" on transactions;
create policy "acces_transactions_etablissement" on transactions
  for all using (
    etablissement_id in (select etablissement_id from membres where user_id = auth.uid())
  );

-- Un membre peut aussi lire l'établissement auquel il appartient (pas seulement le propriétaire)
drop policy if exists "proprietaire_voit_son_etablissement" on etablissements;
create policy "membre_voit_son_etablissement" on etablissements
  for select using (
    id in (select etablissement_id from membres where user_id = auth.uid())
  );
create policy "proprietaire_modifie_son_etablissement" on etablissements
  for update using (proprietaire_id = auth.uid());
create policy "proprietaire_insere_etablissement" on etablissements
  for insert with check (proprietaire_id = auth.uid());
