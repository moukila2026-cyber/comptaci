-- ============================================================
-- SCRIPT COMPTACI — COMPTES UTILISATEURS
-- ============================================================
-- À exécuter dans Supabase → SQL Editor (100% idempotent).
--
-- 1) Table `profiles` : informations réelles de chaque utilisateur
--    (email, téléphone, nom d'établissement), consultables dans
--    Supabase → Table Editor → profiles. Le mot de passe, lui, reste
--    stocké de façon sécurisée (haché) par Supabase dans auth.users —
--    on ne stocke JAMAIS un mot de passe en clair.
--
-- 2) RPC `supprimer_mon_compte()` : permet à un utilisateur de
--    supprimer lui-même son compte (auth.users + toutes ses données).
--    C'est impossible depuis le navigateur (clé anon) ; cette fonction
--    tourne avec les privilèges de la base (SECURITY DEFINER), ce qui
--    permet enfin la suppression demandée.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Table profiles
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  email text,
  telephone text,
  nom_etablissement text,
  cree_le timestamp not null default now(),
  maj_le timestamp not null default now()
);

alter table profiles enable row level security;

drop policy if exists "profil_lecture_soi" on profiles;
create policy "profil_lecture_soi" on profiles
  for select using (user_id = auth.uid());

drop policy if exists "profil_insertion_soi" on profiles;
create policy "profil_insertion_soi" on profiles
  for insert with check (user_id = auth.uid());

drop policy if exists "profil_modification_soi" on profiles;
create policy "profil_modification_soi" on profiles
  for update using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 2) Remplissage automatique du profil à la création du compte
--    (même pour les comptes créés hors de l'application)
-- ------------------------------------------------------------
create or replace function public.creer_profil_nouveau()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, telephone)
  values (new.id, new.email, new.phone)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_creer_profil_nouveau on auth.users;
create trigger trg_creer_profil_nouveau
  after insert on auth.users
  for each row execute function public.creer_profil_nouveau();

-- ------------------------------------------------------------
-- 3) RPC : suppression de son propre compte par l'utilisateur
-- ------------------------------------------------------------
create or replace function public.supprimer_mon_compte()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Authentification requise.';
  end if;

  -- Sessions de caisse ouvertes par cet utilisateur chez un AUTRE
  -- propriétaire : on les rattache au propriétaire de l'établissement
  -- pour ne pas détruire son historique.
  update sessions_caisse s
     set ouverte_par = e.proprietaire_id
    from etablissements e
   where s.etablissement_id = e.id
     and s.ouverte_par = uid;

  -- Table demandes_paiement (créée par un autre script, donc optionnelle)
  if to_regclass('public.demandes_paiement') is not null then
    update demandes_paiement set cree_par = null   where cree_par = uid;
    update demandes_paiement set traite_par = null where traite_par = uid;
    delete from demandes_paiement
     where etablissement_id in (select id from etablissements where proprietaire_id = uid);
  end if;

  -- Données des établissements dont il est propriétaire
  delete from sessions_caisse
   where etablissement_id in (select id from etablissements where proprietaire_id = uid);
  delete from transactions
   where etablissement_id in (select id from etablissements where proprietaire_id = uid);
  delete from produits
   where etablissement_id in (select id from etablissements where proprietaire_id = uid);
  delete from fournisseurs
   where etablissement_id in (select id from etablissements where proprietaire_id = uid);
  delete from membres
   where etablissement_id in (select id from etablissements where proprietaire_id = uid);
  delete from etablissements
   where proprietaire_id = uid;

  -- Appartenances restantes (s'il était gérant d'un autre établissement)
  delete from membres where user_id = uid;

  -- Profil puis compte d'authentification (auth.users)
  delete from profiles where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.supprimer_mon_compte() to authenticated;

-- ------------------------------------------------------------
-- 4) Permettre AUSSI la suppression depuis le tableau de bord
--    Supabase (Authentication → Users → ⋯ → Delete user).
--    Sans ces cascades, Supabase refuse la suppression à cause des
--    clés étrangères qui pointent vers auth.users / etablissements.
--    On recrée chaque clé avec la règle de suppression voulue :
--      · vers auth.users      → CASCADE (ou SET NULL pour les champs
--        facultatifs comme les sessions de caisse d'un autre compte)
--      · vers etablissements  → CASCADE (supprimer un établissement
--        supprime ses ventes, produits, fournisseurs, caisse, membres)
-- ------------------------------------------------------------
do $$
declare
  r record;
  nom_fk text;
  ref_expr text;
begin
  for r in
    select * from (values
      ('etablissements',    'proprietaire_id',   'auth.users',          'cascade',  false),
      ('membres',           'user_id',           'auth.users',          'cascade',  false),
      ('sessions_caisse',   'ouverte_par',       'auth.users',          'set null', true),
      ('demandes_paiement', 'cree_par',          'auth.users',          'set null', true),
      ('demandes_paiement', 'traite_par',        'auth.users',          'set null', true),
      ('membres',           'etablissement_id',  'public.etablissements','cascade', false),
      ('transactions',      'etablissement_id',  'public.etablissements','cascade', false),
      ('produits',          'etablissement_id',  'public.etablissements','cascade', false),
      ('fournisseurs',      'etablissement_id',  'public.etablissements','cascade', false),
      ('sessions_caisse',   'etablissement_id',  'public.etablissements','cascade', false),
      ('demandes_paiement', 'etablissement_id',  'public.etablissements','cascade', false)
    ) as v(tbl, col, reftbl, ondel, setnull)
  loop
    -- Table absente (ex : demandes_paiement jamais créée) → on passe.
    if to_regclass(format('public.%I', r.tbl)) is null then
      continue;
    end if;

    -- Nom de la clé étrangère existante (s'il y en a une).
    select conname into nom_fk
      from pg_constraint
     where conrelid = format('public.%I', r.tbl)::regclass
       and contype = 'f'
       and confrelid = r.reftbl::regclass
       and position(format('FOREIGN KEY (%s)', r.col) in pg_get_constraintdef(oid)) > 0;

    if nom_fk is not null then
      execute format('alter table public.%I drop constraint %I', r.tbl, nom_fk);
    end if;

    -- On autorise NULL quand la règle est SET NULL (champ rendu facultatif).
    if r.setnull then
      execute format('alter table public.%I alter column %I drop not null', r.tbl, r.col);
    end if;

    if r.reftbl = 'auth.users' then
      ref_expr := 'auth.users(id)';
    else
      ref_expr := r.reftbl || '(id)';
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references %s on delete %s',
      r.tbl, r.tbl || '_' || r.col || '_fkey', r.col, ref_expr, r.ondel
    );
  end loop;
end $$;

-- ============================================================
-- FIN — exécutez ce script UNE FOIS dans Supabase → SQL Editor.
-- Résultat :
--  · bouton « Supprimer mon compte » dans l'app (page Abonnement) ;
--  · suppression possible depuis Authentication → Users (Supabase).
-- ============================================================
