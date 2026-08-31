alter table etablissements add column if not exists est_fondateur boolean not null default false;
alter table etablissements add column if not exists essai_jours integer not null default 3;
alter table etablissements add column if not exists tarif_verrouille numeric;

-- Applique automatiquement l'offre fondateur aux 100 premiers établissements
-- créés (peu importe l'ordre d'inscription), et verrouille leur tarif.
create or replace function public.appliquer_offre_fondateur()
returns trigger
language plpgsql
as $$
declare
  compte_fondateurs int;
begin
  -- Verrou anti-concurrence : deux inscriptions simultanées ne peuvent pas
  -- obtenir toutes les deux la 100e place fondateur.
  perform pg_advisory_xact_lock(hashtext('comptaci_offre_fondateur'));

  select count(*) into compte_fondateurs from etablissements where est_fondateur = true;
  if compte_fondateurs < 100 then
    new.est_fondateur := true;
    new.essai_jours := 7;
    new.tarif_verrouille := 7000;
    -- Règle métier : l'offre fondateurs démarre sur le plan STARTER
    -- (7 000 FCFA) ; le choix de Pro / Entreprise s'ouvre à la fin des 7 jours.
    new.plan := 'starter';
  else
    new.est_fondateur := false;
    new.essai_jours := 3;
    new.tarif_verrouille := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_offre_fondateur on etablissements;
create trigger trg_offre_fondateur
  before insert on etablissements
  for each row execute function public.appliquer_offre_fondateur();

-- ------------------------------------------------------------
-- 7bis) Garde-fou : PENDANT l'offre fondateurs (fenêtre de 7 jours),
--       un fondateur reste sur STARTER / 7 000 FCFA. Une fois la
--       fenêtre passée, il choisit librement Starter, Pro ou
--       Entreprise : le garde-fou ne s'applique plus.
--       Fenêtre : now() < date_creation + make_interval(days => coalesce(essai_jours, 7))
-- ------------------------------------------------------------
create or replace function public.empecher_sortie_plan_fondateur()
returns trigger language plpgsql
as $$
begin
  if new.est_fondateur
     and now() < coalesce(new.date_creation, now())
                 + make_interval(days => coalesce(new.essai_jours, 7)) then
    if new.plan is distinct from 'starter' then
      new.plan := 'starter';
    end if;
    if new.tarif_verrouille is null or new.tarif_verrouille <> 7000 then
      new.tarif_verrouille := 7000;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fondateur_plan_starter on etablissements;
create trigger trg_fondateur_plan_starter
  before update on etablissements
  for each row execute function public.empecher_sortie_plan_fondateur();

-- Rattrapage : un fondateur ENCORE dans sa fenêtre d'offre et déjà passé sur
-- pro / entreprise revient en STARTER. Un fondateur hors offre (essai terminé)
-- qui a choisi Pro ou Entreprise n'est jamais touché.
update etablissements
   set plan = 'starter',
       tarif_verrouille = 7000
 where est_fondateur = true
   and (plan is distinct from 'starter' or tarif_verrouille is distinct from 7000)
   and now() < date_creation + make_interval(days => coalesce(essai_jours, 7));

-- Fonction publique pour afficher le nombre de places fondateurs restantes
-- sur la landing page, sans exposer aucune donnée des établissements.
create or replace function public.places_fondateurs_restantes()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select greatest(0, 100 - (select count(*) from etablissements where est_fondateur = true));
$$;

grant execute on function public.places_fondateurs_restantes() to anon, authenticated;
