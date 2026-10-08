-- ============================================================
-- COMPTACI — MIGRATION : stock et suppressions réservés au propriétaire
-- ============================================================
-- À exécuter UNE FOIS dans Supabase → SQL Editor, après supabase-SETUP-FINAL.sql
-- (ou relancer SETUP-FINAL.sql : il contient les mêmes règles).
-- Idempotent : on peut la relancer sans risque, elle ne modifie aucune donnée.
--
-- Règles appliquées par la base (RLS), pas seulement par l'interface :
--   • Gérant (invité par code) : lecture seule du stock. Il ne peut ni ajouter,
--     ni modifier (quantité, seuil d'alerte, prix), ni supprimer un produit.
--   • Ses ventes et dépenses continuent d'ajuster les quantités des produits
--     EXISTANTS, via appliquer_mouvement_stock() : il ne peut ni créer une
--     ligne de stock, ni fixer une quantité.
--   • Suppressions (produits, mouvements, fournisseurs) : propriétaire seul.
--   • Toutes les anciennes politiques de ces trois tables sont retirées
--     (y compris celles des anciens scripts) : aucune ne peut rouvrir l'écriture.
--   • Un gérant peut toujours saisir un mouvement et corriger son montant
--     ou sa note. Type, date et catégorie restent figés pour lui (déclencheur).
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0) Fonctions d'aide (définitions identiques à SETUP-FINAL)
-- ------------------------------------------------------------
create or replace function public.est_membre_de(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from membres
    where etablissement_id = etab_id and user_id = auth.uid()
  );
$$;

create or replace function public.est_proprietaire_de(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from etablissements
    where id = etab_id and proprietaire_id = auth.uid()
  );
$$;

create or replace function public.peut_ecrire_dans(etab_id uuid)
returns boolean language sql security definer set search_path = public stable
as $$
  select public.est_proprietaire_de(etab_id) or public.est_membre_de(etab_id);
$$;

-- ------------------------------------------------------------
-- Retrait de TOUTES les politiques existantes sur ces trois tables, anciens
-- noms et politiques créées à la main compris. Les politiques permissives
-- s'additionnent : une seule ancienne politique suffirait à rouvrir l'écriture
-- aux gérants. Les politiques définies ci-dessous sont donc les seules.
-- ------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('produits', 'transactions', 'fournisseurs')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 1) Stock (produits) : lecture pour tous les membres,
--    écriture (ajout, modification, suppression) pour le propriétaire seul
-- ------------------------------------------------------------
alter table produits enable row level security;

create policy "membres_voient_produits" on produits
  for select using (public.est_membre_de(etablissement_id));

create policy "proprietaire_gere_produits" on produits
  for all using (public.est_proprietaire_de(etablissement_id))
  with check (public.est_proprietaire_de(etablissement_id));

-- ------------------------------------------------------------
-- 2) Mouvements (ventes / dépenses) : saisie et correction pour les membres,
--    suppression pour le propriétaire seul
-- ------------------------------------------------------------
alter table transactions enable row level security;

create policy "membres_voient_transactions" on transactions
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ajoutent_transactions" on transactions
  for insert with check (public.peut_ecrire_dans(etablissement_id));

create policy "membres_modifient_transactions" on transactions
  for update using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

create policy "proprietaire_supprime_transactions" on transactions
  for delete using (public.est_proprietaire_de(etablissement_id));

-- Un gérant ne corrige que le montant et la note d'un mouvement, comme le
-- propose l'application : type, date, catégorie, etc. restent figés pour lui.
-- Le propriétaire n'est pas concerné. Comparaison sur toute la ligne (hors
-- montant et note), donc sans liste de colonnes à maintenir.
create or replace function public.gerant_corrige_montant_note()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.est_proprietaire_de(new.etablissement_id)
     and (to_jsonb(new) - array['montant', 'note'])
         is distinct from (to_jsonb(old) - array['montant', 'note']) then
    raise exception 'Un gérant peut seulement corriger le montant et la note d''un mouvement.';
  end if;
  return new;
end;
$$;

drop trigger if exists gerant_corrige_montant_note on transactions;
create trigger gerant_corrige_montant_note
  before update on transactions
  for each row execute function public.gerant_corrige_montant_note();

-- ------------------------------------------------------------
-- 3) Fournisseurs : saisie et correction pour les membres,
--    suppression pour le propriétaire seul
-- ------------------------------------------------------------
alter table fournisseurs enable row level security;

create policy "membres_voient_fournisseurs" on fournisseurs
  for select using (public.est_membre_de(etablissement_id));

create policy "membres_ajoutent_fournisseurs" on fournisseurs
  for insert with check (public.peut_ecrire_dans(etablissement_id));

create policy "membres_modifient_fournisseurs" on fournisseurs
  for update using (public.peut_ecrire_dans(etablissement_id))
  with check (public.peut_ecrire_dans(etablissement_id));

create policy "proprietaire_supprime_fournisseurs" on fournisseurs
  for delete using (public.est_proprietaire_de(etablissement_id));

-- ------------------------------------------------------------
-- 4) Mouvement → stock : une seule porte d'entrée pour les gérants
--    Une vente diminue la quantité d'un produit suivi, un achat (dépense)
--    l'augmente. La casse de la désignation est ignorée. Le prix unitaire
--    n'est renseigné que s'il manque encore. Seul le propriétaire peut créer
--    une ligne de stock (dépense portant un nom inconnu).
--    SECURITY DEFINER : la fonction contrôle elle-même les droits ci-dessous.
-- ------------------------------------------------------------
drop function if exists public.appliquer_mouvement_stock(uuid, text, numeric, text, numeric);
create or replace function public.appliquer_mouvement_stock(
  p_etablissement_id uuid,
  p_designation text,
  p_quantite numeric,
  p_type text,
  p_prix_unitaire numeric default null
)
returns setof produits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nom text := nullif(btrim(p_designation), '');
  v_variation numeric;
  v_produit produits;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if not public.peut_ecrire_dans(p_etablissement_id) then
    raise exception 'Accès refusé à cet établissement.';
  end if;
  if p_type not in ('vente', 'depense') then
    raise exception 'Type de mouvement inconnu : %', p_type;
  end if;
  if v_nom is null or coalesce(p_quantite, 0) <= 0 then
    return;
  end if;

  v_variation := case when p_type = 'vente' then -p_quantite else p_quantite end;

  -- 1) Produit déjà suivi : ajustement atomique de la quantité.
  update produits pr
     set quantite_stock = pr.quantite_stock + v_variation,
         prix_unitaire = case
           when coalesce(pr.prix_unitaire, 0) = 0 and coalesce(p_prix_unitaire, 0) > 0
             then p_prix_unitaire
           else pr.prix_unitaire
         end,
         maj_le = now()
   where pr.id = (
     select x.id
       from produits x
      where x.etablissement_id = p_etablissement_id
        and lower(x.designation) = lower(v_nom)
      order by x.designation
      limit 1
   )
  returning * into v_produit;
  if found then
    return next v_produit;
    return;
  end if;

  -- 2) Produit inconnu : seul le propriétaire crée une ligne de stock.
  if p_type = 'depense' and public.est_proprietaire_de(p_etablissement_id) then
    insert into produits (etablissement_id, designation, quantite_stock, prix_unitaire)
    values (
      p_etablissement_id,
      v_nom,
      p_quantite,
      case when coalesce(p_prix_unitaire, 0) > 0 then p_prix_unitaire end
    )
    returning * into v_produit;
    return next v_produit;
    return;
  end if;

  return;
end;
$$;

revoke all on function public.appliquer_mouvement_stock(uuid, text, numeric, text, numeric) from public, anon;
grant execute on function public.appliquer_mouvement_stock(uuid, text, numeric, text, numeric) to authenticated;

commit;

-- ============================================================
-- Vérification (SQL Editor) : 10 lignes attendues — 2 pour produits,
-- 4 pour transactions, 4 pour fournisseurs. Aucune ligne « membres_ecrivent_… ».
-- ============================================================
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('produits', 'transactions', 'fournisseurs')
 order by tablename, policyname;

-- La fonction de mouvement doit renvoyer « setof produits ».
select proname, pg_get_function_result(oid) as retour
  from pg_proc
 where proname = 'appliquer_mouvement_stock';
