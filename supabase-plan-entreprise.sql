alter table etablissements drop constraint if exists etablissements_plan_check;
alter table etablissements add constraint etablissements_plan_check
  check (plan in ('starter', 'pro', 'entreprise'));
