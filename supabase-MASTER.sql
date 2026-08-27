-- ============================================
-- SCRIPT MAÎTRE COMPTACI — à exécuter en une fois
-- Sans risque même si certaines parties ont déjà
-- été lancées auparavant.
-- ============================================

-- 1) Rôles propriétaire / gérant -------------------------------------------
alter table etablissements add column if not exists code_invitation text unique;
update etablissements set code_invitation = upper(substr(md5(random()::text), 1, 6)) where code_invitation is null;
alter table etablissements alter column code_invitation set default upper(substr(md5(random()::text), 1, 6));

create table if not exists membres (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  user_id uuid references auth.users not null,
  role text not null default 'gerant' check (role in ('proprietaire', 'gerant')),
  cree_le timestamp default now(),
  unique (etablissement_id, user_id)
);
alter table membres enable row level security;

drop policy if exists "membre_voit_ses_etablissements" on membres;
create policy "membre_voit_ses_etablissements" on membres for select using (user_id = auth.uid());

drop policy if exists "proprietaire_gere_les_membres" on membres;
create policy "proprietaire_gere_les_membres" on membres for all using (
  etablissement_id in (select id from etablissements where proprietaire_id = auth.uid())
);

insert into membres (etablissement_id, user_id, role)
select id, proprietaire_id, 'proprietaire' from etablissements
on conflict (etablissement_id, user_id) do nothing;

-- 2) Fonction anti-récursion pour les règles de sécurité --------------------
create or replace function public.est_membre_de(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (select 1 from membres where etablissement_id = etab_id and user_id = auth.uid());
$$;

drop policy if exists "membre_voit_son_etablissement" on etablissements;
drop policy if exists "proprietaire_voit_son_etablissement" on etablissements;
create policy "membre_voit_son_etablissement" on etablissements for select using (est_membre_de(id));

drop policy if exists "proprietaire_modifie_son_etablissement" on etablissements;
create policy "proprietaire_modifie_son_etablissement" on etablissements for update using (proprietaire_id = auth.uid());

drop policy if exists "proprietaire_insere_etablissement" on etablissements;
create policy "proprietaire_insere_etablissement" on etablissements for insert with check (proprietaire_id = auth.uid());

drop policy if exists "acces_transactions_etablissement" on transactions;
create policy "acces_transactions_etablissement" on transactions for all using (est_membre_de(etablissement_id));

-- 3) Correction du parcours d'inscription du gérant --------------------------
create or replace function public.etablissement_par_code(code text)
returns uuid language sql security definer set search_path = public stable
as $$
  select id from etablissements where code_invitation = upper(trim(code)) limit 1;
$$;
grant execute on function public.etablissement_par_code(text) to anon, authenticated;

drop policy if exists "utilisateur_rejoint_comme_gerant" on membres;
create policy "utilisateur_rejoint_comme_gerant" on membres for insert with check (user_id = auth.uid() and role = 'gerant');

-- 4) Formules tarifaires -----------------------------------------------------
alter table etablissements add column if not exists plan text not null default 'starter' check (plan in ('starter', 'pro'));

-- 5) Secteurs d'activité ------------------------------------------------------
alter table etablissements add column if not exists secteur text not null default 'restauration'
  check (secteur in ('restauration', 'quincaillerie', 'boutique', 'pharmacie'));

-- 6) Gestion de stock ---------------------------------------------------------
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
drop policy if exists "acces_produits_etablissement" on produits;
create policy "acces_produits_etablissement" on produits for all using (est_membre_de(etablissement_id));

-- 7) Sessions de caisse ---------------------------------------------------------
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
drop policy if exists "acces_sessions_caisse_etablissement" on sessions_caisse;
create policy "acces_sessions_caisse_etablissement" on sessions_caisse for all using (est_membre_de(etablissement_id));

-- ============================================
-- FIN DU SCRIPT
-- ============================================
