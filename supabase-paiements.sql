-- ============================================================
-- COMPTACI — Migration paiements Wave uniquement
-- À utiliser si supabase-SETUP-FINAL.sql a déjà été exécuté
-- AVANT l'ajout de la section 14. Sinon, préfère SETUP-FINAL.
-- Idempotent.
-- ============================================================

-- 14) Table demandes_paiement + activation manuelle (admin)
-- ------------------------------------------------------------
-- Parcours client : scan QR Wave → « J'ai payé » → ligne en_attente.
-- L'admin ComptaCi valide dans Supabase (ou via RPC valider_paiement)
-- ce qui active abonnement_actif + plan sur l'établissement.
create table if not exists demandes_paiement (
  id uuid primary key default gen_random_uuid(),
  etablissement_id uuid references etablissements not null,
  plan text not null check (plan in ('starter', 'pro', 'entreprise')),
  montant numeric not null,
  telephone_payeur text,
  reference_wave text,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'valide', 'refuse', 'annule')),
  note_admin text,
  cree_par uuid references auth.users,
  cree_le timestamp not null default now(),
  traite_le timestamp,
  traite_par uuid references auth.users
);

create index if not exists idx_demandes_paiement_etab
  on demandes_paiement (etablissement_id, statut, cree_le desc);

alter table demandes_paiement enable row level security;

drop policy if exists "membres_voient_demandes_paiement" on demandes_paiement;
create policy "membres_voient_demandes_paiement" on demandes_paiement
  for select using (public.est_membre_de(etablissement_id));

-- Seul le propriétaire (ou un membre) peut déclarer un paiement pour son établissement.
drop policy if exists "membres_creent_demandes_paiement" on demandes_paiement;
create policy "membres_creent_demandes_paiement" on demandes_paiement
  for insert with check (
    public.peut_ecrire_dans(etablissement_id)
    and (cree_par is null or cree_par = auth.uid())
  );

-- Pas d'UPDATE/delete côté client : seul le service_role (SQL Editor / dashboard)
-- ou la RPC admin ci-dessous peut changer le statut.

-- Renseigner automatiquement cree_par
create or replace function public.demandes_paiement_set_auteur()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.cree_par is null then
    new.cree_par := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_demandes_paiement_auteur on demandes_paiement;
create trigger trg_demandes_paiement_auteur
  before insert on demandes_paiement
  for each row execute function public.demandes_paiement_set_auteur();

-- RPC admin : valider une demande → active l'abonnement + pose le plan.
-- À appeler depuis le SQL Editor (service role) ou un futur back-office :
--   select public.valider_paiement('<uuid_demande>');
create or replace function public.valider_paiement(demande_id uuid, note text default null)
returns demandes_paiement
language plpgsql
security definer
set search_path = public
as $$
declare
  d demandes_paiement;
begin
  select * into d from demandes_paiement where id = demande_id for update;
  if not found then
    raise exception 'Demande de paiement introuvable.';
  end if;
  if d.statut = 'valide' then
    return d;
  end if;

  update etablissements
    set abonnement_actif = true,
        plan = d.plan
    where id = d.etablissement_id;

  update demandes_paiement
    set statut = 'valide',
        traite_le = now(),
        traite_par = auth.uid(),
        note_admin = coalesce(note, note_admin)
    where id = demande_id
    returning * into d;

  return d;
end;
$$;

-- Réservée au service_role / SQL Editor (pas exposée à anon/authenticated).
revoke all on function public.valider_paiement(uuid, text) from public, anon, authenticated;

-- RPC admin : refuser une demande (laisse l'accès bloqué).
create or replace function public.refuser_paiement(demande_id uuid, note text default null)
returns demandes_paiement
language plpgsql
security definer
set search_path = public
as $$
declare
  d demandes_paiement;
begin
  update demandes_paiement
    set statut = 'refuse',
        traite_le = now(),
        traite_par = auth.uid(),
        note_admin = coalesce(note, note_admin)
    where id = demande_id
    returning * into d;
  if not found then
    raise exception 'Demande de paiement introuvable.';
  end if;
  return d;
end;
$$;
revoke all on function public.refuser_paiement(uuid, text) from public, anon, authenticated;

-- Vue pratique pour l'admin (SQL Editor) : file d'attente des paiements.
create or replace view public.v_paiements_en_attente as
select
  d.id as demande_id,
  d.cree_le,
  d.plan,
  d.montant,
  d.telephone_payeur,
  d.reference_wave,
  d.statut,
  e.id as etablissement_id,
  e.nom as etablissement_nom,
  e.telephone as etablissement_telephone,
  e.plan as plan_actuel,
  e.abonnement_actif,
  e.est_fondateur
from demandes_paiement d
join etablissements e on e.id = d.etablissement_id
where d.statut = 'en_attente'
order by d.cree_le asc;


-- Admin — exemples :
--   select * from v_paiements_en_attente;
--   select public.valider_paiement('<uuid_demande>');
--   select public.refuser_paiement('<uuid_demande>', 'motif');
