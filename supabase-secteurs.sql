alter table etablissements
  add column if not exists secteur text not null default 'restauration'
  check (secteur in ('restauration', 'quincaillerie', 'boutique', 'pharmacie'));
