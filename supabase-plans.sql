alter table etablissements
  add column if not exists plan text not null default 'starter'
  check (plan in ('starter', 'pro'));
