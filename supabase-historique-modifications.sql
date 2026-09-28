-- À exécuter dans Supabase → SQL Editor APRÈS l'initialisation de la base
-- (supabase-SETUP-FINAL.sql ou tables équivalentes du script maître).
-- Idempotent. Journal prospectif : aucune reconstitution du passé.
begin;

create table if not exists public.historique_modifications (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid not null references public.etablissements(id) on delete cascade,
  cree_le timestamptz not null default clock_timestamp(),
  -- Pas de FK sur l'auteur/l'objet : leur suppression ne doit pas effacer la trace.
  auteur_id uuid,
  auteur_identifiant text,
  auteur_role text,
  entite text not null check (entite in ('transactions', 'produits', 'fournisseurs', 'sessions_caisse', 'etablissements')),
  enregistrement_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  avant jsonb,
  apres jsonb
);
create index if not exists historique_modifications_etab_date_idx
  on public.historique_modifications (etablissement_id, cree_le desc, id desc);

alter table public.historique_modifications enable row level security;
-- Ni le propriétaire ni le gérant ne peuvent écrire/falsifier le journal via l'API.
revoke all on public.historique_modifications from public, anon, authenticated;
grant select on public.historique_modifications to authenticated;
drop policy if exists proprietaire_lit_modifications on public.historique_modifications;
create policy proprietaire_lit_modifications on public.historique_modifications
  for select to authenticated using (
    exists (select 1 from public.etablissements e
      where e.id = etablissement_id and e.proprietaire_id = (select auth.uid()))
  );

create or replace function public.journaliser_modification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  ancien jsonb;
  nouveau jsonb;
  champs text[];
  etab uuid;
  objet uuid;
  acteur uuid := auth.uid();
  identifiant text;
  role_acteur text;
begin
  -- Liste blanche : jamais de clés API FNE, de code d'invitation, ni de secrets.
  champs := case tg_table_name
    when 'transactions' then array['type','montant','categorie','note','date','quantite','designation','poste_id']
    when 'produits' then array['designation','quantite_stock','prix_unitaire','seuil_alerte']
    when 'fournisseurs' then array['nom','telephone','note']
    when 'sessions_caisse' then array['fond_ouverture','date_ouverture','fond_fermeture_reel','ecart','date_fermeture','statut']
    when 'etablissements' then array['nom','telephone','secteur','plan','abonnement_actif']
    else null end;
  if champs is null then
    raise exception 'Table non prise en charge par le journal';
  end if;

  if tg_op <> 'INSERT' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into ancien
      from jsonb_each(to_jsonb(old)) where key = any(champs);
  end if;
  if tg_op <> 'DELETE' then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into nouveau
      from jsonb_each(to_jsonb(new)) where key = any(champs);
  end if;
  if tg_op = 'UPDATE' then
    -- Un déplacement inter-établissements mélangerait leurs données dans le journal.
    if tg_table_name <> 'etablissements' then
      if old.etablissement_id <> new.etablissement_id then
        raise exception 'Le déplacement entre établissements est interdit';
      end if;
    end if;
    -- Ignorer les mises à jour sans effet et les seules dates techniques (maj_le).
    if ancien is not distinct from nouveau then return new; end if;
  end if;

  if tg_table_name = 'etablissements' then
    etab := new.id;
    objet := new.id;
  elsif tg_op = 'DELETE' then
    etab := old.etablissement_id;
    objet := old.id;
  else
    etab := new.etablissement_id;
    objet := new.id;
  end if;
  -- Lors d'une suppression en cascade, l'établissement n'existe déjà plus.
  -- Son journal est supprimé avec lui (y compris via supprimer_mon_compte).
  if not exists (select 1 from public.etablissements where id = etab) then
    return null;
  end if;

  select coalesce(nullif(u.phone, ''), nullif(u.email, ''), u.id::text)
    into identifiant from auth.users u where u.id = acteur;
  select case when e.proprietaire_id = acteur then 'proprietaire'
    else (select m.role from public.membres m
      where m.etablissement_id = etab and m.user_id = acteur limit 1) end
    into role_acteur from public.etablissements e where e.id = etab;

  insert into public.historique_modifications
    (etablissement_id, auteur_id, auteur_identifiant, auteur_role, entite, enregistrement_id, action, avant, apres)
  values (etab, acteur, identifiant, role_acteur, tg_table_name, objet, tg_op, ancien, nouveau);
  return null; -- AFTER : la valeur de retour n'est pas utilisée.
end;
$$;
revoke all on function public.journaliser_modification() from public, anon, authenticated;

-- Les actions des propriétaires ET des gérants sont capturées dans la même
-- transaction que l'écriture métier : un échec/rollback ne laisse aucune trace.
do $$
declare tbl text;
begin
  foreach tbl in array array['transactions','produits','fournisseurs','sessions_caisse'] loop
    execute format('drop trigger if exists trg_historique_modifications on public.%I', tbl);
    execute format('create trigger trg_historique_modifications after insert or update or delete on public.%I for each row execute function public.journaliser_modification()', tbl);
  end loop;
end $$;
drop trigger if exists trg_historique_modifications on public.etablissements;
-- Pas de DELETE ici : le journal disparaît avec l'établissement.
create trigger trg_historique_modifications after insert or update on public.etablissements
  for each row execute function public.journaliser_modification();

commit;
