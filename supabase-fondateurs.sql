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
  select count(*) into compte_fondateurs from etablissements where est_fondateur = true;
  if compte_fondateurs < 100 then
    new.est_fondateur := true;
    new.essai_jours := 7;
    new.tarif_verrouille := 7000;
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
