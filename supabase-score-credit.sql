-- ============================================================================
--  ComptaCi — Score de crédit : historique (crédibilité auprès d'une banque)
--  À exécuter dans Supabase → SQL Editor (propriété non destructive).
--
--  Un score ponctuel prouve peu ; une PROGRESSION sur plusieurs mois prouve
--  une gestion sérieuse. On enregistre donc un point d'historique par
--  établissement et par mois (un seul point par mois, mise à jour ensuite).
-- ============================================================================

create table if not exists scores_credit (
  id                uuid primary key default gen_random_uuid(),
  etablissement_id  uuid not null references etablissements (id) on delete cascade,
  -- Clé de mois « AAAA-MM » : un seul point d'historique par mois.
  periode           char(7) not null,
  score             smallint not null check (score between 0 and 100),
  palier            text not null check (palier in ('bronze', 'argent', 'or')),
  objectifs_atteints smallint not null default 0,
  objectifs_total   smallint not null default 0,
  ca_90j            numeric(16, 2) not null default 0,
  depenses_90j      numeric(16, 2) not null default 0,
  regularite_pct    numeric(5, 2) not null default 0,
  anciennete_jours  integer not null default 0,
  detail            jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint scores_credit_etab_periode_key unique (etablissement_id, periode)
);

create index if not exists scores_credit_etab_idx
  on scores_credit (etablissement_id, periode desc);

comment on table scores_credit is
  'Historique mensuel du score de crédit ComptaCi (preuve de progression pour un prêteur).';

-- ---------------------------------------------------------------------------
-- Sécurité RLS : un établissement ne voit et n'écrit que son propre historique
-- ---------------------------------------------------------------------------
alter table scores_credit enable row level security;

drop policy if exists "scores_credit_lecture_membres" on scores_credit;
create policy "scores_credit_lecture_membres"
  on scores_credit for select
  using (
    exists (
      select 1
        from membres m
       where m.etablissement_id = scores_credit.etablissement_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists "scores_credit_ecriture_membres" on scores_credit;
create policy "scores_credit_ecriture_membres"
  on scores_credit for insert
  with check (
    exists (
      select 1
        from membres m
       where m.etablissement_id = scores_credit.etablissement_id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists "scores_credit_maj_membres" on scores_credit;
create policy "scores_credit_maj_membres"
  on scores_credit for update
  using (
    exists (
      select 1
        from membres m
       where m.etablissement_id = scores_credit.etablissement_id
         and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
        from membres m
       where m.etablissement_id = scores_credit.etablissement_id
         and m.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Enregistrement « upsert » du point du mois (idempotent, sûr côté RLS)
-- ---------------------------------------------------------------------------
create or replace function public.enregistrer_score_credit(
  p_etablissement_id uuid,
  p_periode          text,
  p_score            integer,
  p_palier           text,
  p_objectifs_atteints integer,
  p_objectifs_total  integer,
  p_ca_90j           numeric,
  p_depenses_90j     numeric,
  p_regularite_pct   numeric,
  p_anciennete_jours integer,
  p_detail           jsonb default '[]'::jsonb
)
returns scores_credit
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligne scores_credit;
begin
  -- On refuse d'écrire pour un établissement dont l'utilisateur n'est pas membre.
  if not exists (
    select 1 from membres m
     where m.etablissement_id = p_etablissement_id
       and m.user_id = auth.uid()
  ) then
    raise exception 'non autorise pour cet etablissement';
  end if;

  insert into scores_credit (
    etablissement_id, periode, score, palier,
    objectifs_atteints, objectifs_total,
    ca_90j, depenses_90j, regularite_pct, anciennete_jours, detail
  )
  values (
    p_etablissement_id, p_periode,
    least(100, greatest(0, p_score)), p_palier,
    p_objectifs_atteints, p_objectifs_total,
    coalesce(p_ca_90j, 0), coalesce(p_depenses_90j, 0),
    coalesce(p_regularite_pct, 0), coalesce(p_anciennete_jours, 0),
    coalesce(p_detail, '[]'::jsonb)
  )
  on conflict (etablissement_id, periode) do update
     set score             = excluded.score,
         palier            = excluded.palier,
         objectifs_atteints = excluded.objectifs_atteints,
         objectifs_total   = excluded.objectifs_total,
         ca_90j            = excluded.ca_90j,
         depenses_90j      = excluded.depenses_90j,
         regularite_pct    = excluded.regularite_pct,
         anciennete_jours  = excluded.anciennete_jours,
         detail            = excluded.detail,
         updated_at        = now()
  returning * into v_ligne;

  return v_ligne;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------------------
-- select periode, score, palier, objectifs_atteints, ca_90j
--   from scores_credit order by periode desc limit 12;
