-- Bug 1 : fonction manquante pour retrouver un établissement par son code
-- d'invitation. Elle doit "voir" tous les établissements (via security
-- definer) car un futur gérant n'est pas encore membre au moment de la
-- recherche, donc bloqué par la règle normale de lecture.
create or replace function public.etablissement_par_code(code text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from etablissements where code_invitation = upper(trim(code)) limit 1;
$$;

grant execute on function public.etablissement_par_code(text) to anon, authenticated;

-- Bug 2 : aucune règle n'autorisait un nouvel utilisateur à s'ajouter
-- lui-même comme gérant dans "membres". On ajoute cette autorisation,
-- limitée strictement au rôle "gerant" (jamais "proprietaire").
create policy "utilisateur_rejoint_comme_gerant" on membres
  for insert
  with check (user_id = auth.uid() and role = 'gerant');
