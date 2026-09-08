-- Exécuter après supabase-SETUP-FINAL.sql dans Supabase SQL Editor.
-- Idempotent : conserve la date d'inscription, les abonnements payés et les prolongations.
begin;
alter table public.etablissements alter column essai_jours set default 14;

create or replace function public.appliquer_offre_fondateur()
returns trigger language plpgsql
as $$
declare
  compte_fondateurs int;
begin
  -- Verrou anti-concurrence : deux inscriptions simultanées ne peuvent pas
  -- obtenir toutes les deux la 100e place fondateur.
  perform pg_advisory_xact_lock(hashtext('comptaci_offre_fondateur'));

  select count(*) into compte_fondateurs from etablissements where est_fondateur = true;
  new.essai_jours := 14;
  if compte_fondateurs < 100 then
    new.est_fondateur := true;
    new.tarif_verrouille := 7000;
    -- Règle métier : l'offre fondateurs démarre sur le plan STARTER
    -- (7 000 FCFA) ; le choix de Pro / Entreprise s'ouvre à la fin des 14 jours.
    new.plan := 'starter';
  else
    new.est_fondateur := false;
    new.tarif_verrouille := null;
  end if;
  return new;
end;
$$;

create or replace function public.empecher_sortie_plan_fondateur()
returns trigger language plpgsql
as $$
begin
  if new.est_fondateur
     and not coalesce(new.abonnement_actif, false)
     and now() < coalesce(new.date_creation, now())
                 + make_interval(days => coalesce(new.essai_jours, 14)) then
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

create or replace function public.forcer_plan_fondateur_demande()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  e etablissements;
begin
  select * into e from etablissements where id = new.etablissement_id;
  if e.est_fondateur
     and not coalesce(e.abonnement_actif, false)
     and now() < coalesce(e.date_creation, now())
                 + make_interval(days => coalesce(e.essai_jours, 14)) then
    new.plan := 'starter';
    new.montant := coalesce(e.tarif_verrouille, 7000);
  end if;
  return new;
end;
$$;

update public.etablissements
   set essai_jours = 14
 where essai_jours is null or essai_jours < 14;
commit;
