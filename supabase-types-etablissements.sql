-- ============================================================================
--  ComptaCi — Types d'établissement élargis + essai gratuit de 14 jours
--  À exécuter dans Supabase → SQL Editor (sans supprimer aucune donnée).
--
--  1. essai gratuit : 7 jours -> 14 jours pour tous les nouveaux comptes
--  2. secteur : 4 valeurs -> 10 types d'établissement (restaurant, bar,
--     maquis, hôtel, quincaillerie, boutique, salon de coiffure et beauté,
--     boutique d'accessoires de téléphone, boutique de vêtements, pharmacie)
--  3. conversion automatique des anciennes valeurs (restauration -> restaurant)
--  4. colonne poste_id sur les transactions (rattachement d'une dépense à son
--     poste réel : « biscuits », « eau de javel », « faux ongles »…)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Essai gratuit de 14 jours
-- ---------------------------------------------------------------------------
alter table etablissements
  alter column essai_jours set default 14;

-- Les essais déjà en cours passent de 7 à 14 jours : on allonge la période en
-- cours sans jamais la raccourcir (greatest = garde-fou).
update etablissements
   set essai_jours = 14
 where essai_jours is null
    or essai_jours < 14;

-- ---------------------------------------------------------------------------
-- 2. Élargissement de la liste des types d'établissement
-- ---------------------------------------------------------------------------
alter table etablissements drop constraint if exists etablissements_secteur_check;

-- Requalifie les anciennes valeurs avant de poser la nouvelle contrainte.
update etablissements set secteur = 'restaurant'   where secteur = 'restauration';
update etablissements set secteur = 'boutique'     where secteur in ('alimentation', 'superette', 'epicerie');
update etablissements set secteur = 'salon_beaute' where secteur in ('coiffure', 'salon', 'beaute');
update etablissements set secteur = 'accessoires_telephone'
  where secteur in ('telephone', 'accessoires');
update etablissements set secteur = 'vetements'    where secteur = 'habillement';
update etablissements set secteur = 'restaurant'   where secteur is null;

-- Filet de sécurité : toute valeur inconnue est ramenée à 'restaurant' pour que
-- la contrainte puisse être posée même sur une base contenant des résidus.
update etablissements
   set secteur = 'restaurant'
 where secteur not in (
   'restaurant', 'bar', 'maquis', 'hotel', 'quincaillerie',
   'boutique', 'salon_beaute', 'accessoires_telephone', 'vetements', 'pharmacie'
 );

alter table etablissements
  add constraint etablissements_secteur_check
  check (secteur in (
    'restaurant',            -- Restaurant
    'bar',                   -- Bar
    'maquis',                -- Maquis
    'hotel',                 -- Hôtel
    'quincaillerie',         -- Quincaillerie
    'boutique',              -- Boutique (épicerie / supérette)
    'salon_beaute',          -- Salon de coiffure et beauté
    'accessoires_telephone', -- Boutique d'accessoires de téléphone
    'vetements',             -- Boutique de vêtements
    'pharmacie'              -- Pharmacie
  ));

-- ---------------------------------------------------------------------------
-- 3. Mise à jour de la fonction de création d'établissement
--    (recréée seulement si elle existe déjà)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'creer_etablissement'
  ) then
    execute '
      create or replace function public.creer_etablissement(p_nom text, p_secteur text default ''restaurant'')
      returns etablissements
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      declare
        v_secteur text;
        v_etab    etablissements;
      begin
        -- Le secteur demandé est validé : toute valeur inconnue tombe sur le
        -- type par défaut au lieu de faire échouer l''inscription.
        if p_secteur in (
          ''restaurant'', ''bar'', ''maquis'', ''hotel'', ''quincaillerie'',
          ''boutique'', ''salon_beaute'', ''accessoires_telephone'', ''vetements'', ''pharmacie''
        ) then
          v_secteur := p_secteur;
        elsif p_secteur = ''restauration'' then
          v_secteur := ''restaurant'';
        elsif p_secteur in (''alimentation'', ''superette'', ''epicerie'') then
          v_secteur := ''boutique'';
        elsif p_secteur in (''coiffure'', ''salon'', ''beaute'') then
          v_secteur := ''salon_beaute'';
        elsif p_secteur in (''telephone'', ''accessoires'') then
          v_secteur := ''accessoires_telephone'';
        elsif p_secteur = ''habillement'' then
          v_secteur := ''vetements'';
        else
          v_secteur := ''restaurant'';
        end if;

        insert into etablissements (nom, secteur, proprietaire_id)
        values (p_nom, v_secteur, auth.uid())
        returning * into v_etab;

        insert into membres (etablissement_id, user_id, role)
        values (v_etab.id, auth.uid(), ''proprietaire'');

        return v_etab;
      end;
      $fn$;
    ';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Offre fondateurs : 14 jours (au lieu de 7) + 0 FCFA pendant l'essai
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'appliquer_offre_fondateur'
  ) then
    execute '
      create or replace function public.appliquer_offre_fondateur()
      returns trigger
      language plpgsql
      as $fn$
      declare
        compte_fondateurs int;
      begin
        perform pg_advisory_xact_lock(hashtext(''comptaci_offre_fondateur''));
        select count(*) into compte_fondateurs from etablissements where est_fondateur = true;
        -- 14 jours d''essai gratuit (0 FCFA) pour tout le monde.
        new.essai_jours := 14;
        if compte_fondateurs < 100 then
          new.est_fondateur := true;
          new.plan := ''starter'';
          new.tarif_verrouille := 7000;
        else
          new.est_fondateur := false;
          new.tarif_verrouille := null;
        end if;
        return new;
      end;
      $fn$;
    ';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rattachement d'une dépense à son poste réel (répartition du tableau de bord)
-- ---------------------------------------------------------------------------
alter table transactions add column if not exists poste_id text;

create index if not exists transactions_poste_id_idx on transactions (poste_id);

comment on column transactions.poste_id is
  'Identifiant du poste de dépense du secteur (ex : biscuits, javel, faux_ongles). '
  'Sert à la répartition « dépenses réelles de votre activité ».';

-- ---------------------------------------------------------------------------
-- 6. Vérification
-- ---------------------------------------------------------------------------
-- select secteur, count(*) from etablissements group by secteur order by 2 desc;
-- select essai_jours, count(*) from etablissements group by essai_jours;
