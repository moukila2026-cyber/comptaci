-- L'essai standard passe de 3 à 14 jours pour tous les nouveaux établissements.
-- Les fondateurs gardent leur avantage propre (tarif verrouillé), l'essai
-- étant désormais le même pour tous.
create or replace function public.appliquer_offre_fondateur()
returns trigger
language plpgsql
as $$
declare
  compte_fondateurs int;
begin
  perform pg_advisory_xact_lock(hashtext('comptaci_offre_fondateur'));
        select count(*) into compte_fondateurs from etablissements where est_fondateur = true;
  new.essai_jours := 14;
  if compte_fondateurs < 100 then
    new.est_fondateur := true;
          new.plan := 'starter';
    new.tarif_verrouille := 7000;
  else
    new.est_fondateur := false;
    new.tarif_verrouille := null;
  end if;
  return new;
end;
$$;
