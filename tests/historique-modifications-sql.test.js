import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '00000000-0000-0000-0000-000000000001';
const manager = '00000000-0000-0000-0000-000000000002';
const otherOwner = '00000000-0000-0000-0000-000000000003';
const etab = '00000000-0000-0000-0000-000000000011';
const otherEtab = '00000000-0000-0000-0000-000000000012';

// Vrai moteur PostgreSQL embarqué : triggers, droits SQL et RLS, sans compte distant.
test('Journal SQL : audit atomique, accès propriétaire, isolation et suppressions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text, phone text);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      create table etablissements (id uuid primary key default gen_random_uuid(), proprietaire_id uuid, nom text, telephone text, secteur text, plan text, abonnement_actif boolean, fne_api_key text, code_invitation text);
      create table membres (id uuid primary key default gen_random_uuid(), etablissement_id uuid references etablissements on delete cascade, user_id uuid, role text);
      create table transactions (id uuid primary key default gen_random_uuid(), etablissement_id uuid references etablissements on delete cascade, type text, montant numeric, note text, quantite numeric, date date default current_date);
      create table produits (id uuid primary key default gen_random_uuid(), etablissement_id uuid references etablissements on delete cascade, designation text, quantite_stock numeric, seuil_alerte numeric, prix_unitaire numeric, maj_le timestamp);
      create table fournisseurs (id uuid primary key default gen_random_uuid(), etablissement_id uuid references etablissements on delete cascade, nom text, telephone text, note text);
      create table sessions_caisse (id uuid primary key default gen_random_uuid(), etablissement_id uuid references etablissements on delete cascade, fond_ouverture numeric, statut text, fond_fermeture_reel numeric, ecart numeric);
      insert into auth.users values ('${owner}', 'proprietaire@example.test', null), ('${manager}', 'gerant@example.test', null), ('${otherOwner}', 'autre@example.test', null);
      insert into etablissements (id, proprietaire_id, nom, fne_api_key, code_invitation) values
        ('${etab}', '${owner}', 'Boutique A', 'secret-api', 'SECRET'), ('${otherEtab}', '${otherOwner}', 'Boutique B', null, null);
      insert into membres (etablissement_id, user_id, role) values
        ('${etab}', '${owner}', 'proprietaire'), ('${etab}', '${manager}', 'gerant'),
        ('${otherEtab}', '${otherOwner}', 'proprietaire'), ('${otherEtab}', '${owner}', 'gerant');
      grant select on etablissements, membres to authenticated;
      grant all on transactions, produits, fournisseurs, sessions_caisse to authenticated;
      alter table etablissements enable row level security;
      create policy membre_voit_etab on etablissements for select to authenticated using (
        id in (select etablissement_id from membres where user_id = auth.uid())
      );
    `);
    const migration = await readFile(new URL('../supabase-historique-modifications.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // réexécution sans doublons de triggers/policies
    const login = async id => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
      await db.exec('set role authenticated');
    };
    const journal = async () => (await db.query('select * from historique_modifications order by cree_le, id')).rows;

    await login(manager);
    const { rows: [tx] } = await db.query(`insert into transactions (etablissement_id, type, montant, note) values ($1, 'vente', 1000, 'Vente test') returning id`, [etab]);
    await db.query('update transactions set montant = 1500, note = $1 where id = $2', ['Correction', tx.id]);
    await db.query('update transactions set montant = 1500 where id = $1', [tx.id]); // pas de changement
    await db.query('delete from transactions where id = $1', [tx.id]);
    assert.deepEqual(await journal(), [], 'Le gérant ne peut pas lire le journal, même via SQL/API');
    for (const sql of [
      `insert into historique_modifications (etablissement_id, entite, enregistrement_id, action) values ('${etab}', 'transactions', '${tx.id}', 'INSERT')`,
      "update historique_modifications set auteur_role = 'proprietaire'",
      'delete from historique_modifications',
      'truncate historique_modifications',
    ]) await assert.rejects(db.exec(sql), /permission denied/);

    await login(owner);
    let lignes = await journal();
    assert.equal(lignes.length, 3);
    assert.deepEqual(lignes.map(l => l.action), ['INSERT', 'UPDATE', 'DELETE']);
    assert.equal(lignes[1].avant.montant, 1000);
    assert.equal(lignes[1].apres.montant, 1500);
    assert.equal(lignes[1].avant.note, 'Vente test');
    assert.equal(lignes[1].auteur_id, manager);
    assert.equal(lignes[1].auteur_identifiant, 'gerant@example.test');
    assert.equal(lignes[1].auteur_role, 'gerant');
    assert.equal(lignes[2].apres, null);
    assert.equal(lignes[2].avant.montant, 1500);
    await assert.rejects(db.exec('delete from historique_modifications'), /permission denied/, 'Propriétaire aussi en lecture seule');

    await db.exec('begin');
    await db.query(`insert into transactions (etablissement_id, montant) values ($1, 999)`, [etab]);
    await db.exec('rollback');
    assert.equal((await journal()).length, 3, 'Rollback métier = rollback du journal');
    const { rows: [produit] } = await db.query(`insert into produits (etablissement_id, designation, quantite_stock) values ($1, 'Riz', 10) returning id`, [etab]);
    await db.query('update produits set quantite_stock = 8 where id = $1', [produit.id]);
    await db.query('update produits set maj_le = now() where id = $1', [produit.id]);
    assert.equal((await journal()).length, 5, 'maj_le seul ne génère pas d’événement');
    await assert.rejects(db.query('update produits set etablissement_id = $1 where id = $2', [otherEtab, produit.id]), /déplacement/);
    await db.query(`insert into fournisseurs (etablissement_id, nom) values ($1, 'Fournisseur test')`, [etab]);
    const { rows: [caisse] } = await db.query(`insert into sessions_caisse (etablissement_id, fond_ouverture, statut) values ($1, 5000, 'ouverte') returning id`, [etab]);
    await db.query(`update sessions_caisse set statut = 'fermee', fond_fermeture_reel = 4500, ecart = -500 where id = $1`, [caisse.id]);
    lignes = await journal();
    assert.equal(lignes.length, 8);
    assert.equal(lignes.at(-1).auteur_role, 'proprietaire');
    assert.equal(lignes.at(-1).apres.ecart, -500);

    await login(otherOwner);
    assert.equal((await journal()).length, 0, 'Un autre propriétaire ne voit pas A');
    await db.query(`insert into transactions (etablissement_id, montant) values ($1, 200)`, [otherEtab]);
    assert.equal((await journal()).length, 1);
    await login(owner);
    assert.equal((await journal()).length, 8, 'Propriétaire de A mais gérant de B : uniquement A');

    await db.exec('reset role');
    await db.query('update etablissements set nom = $1, fne_api_key = $2 where id = $3', ['Nouveau nom', 'secret-nouveau', etab]);
    lignes = await journal();
    const changementEtab = lignes.at(-1);
    assert.equal(changementEtab.entite, 'etablissements');
    assert.equal(changementEtab.avant.nom, 'Boutique A');
    assert.equal(changementEtab.apres.nom, 'Nouveau nom');
    assert.ok(!('fne_api_key' in changementEtab.apres));
    assert.ok(!('code_invitation' in changementEtab.avant));
    await db.query('update etablissements set fne_api_key = $1 where id = $2', ['autre-secret', etab]);
    assert.equal((await journal()).length, lignes.length, 'Les secrets ne sont jamais journalisés');
    await db.query('delete from auth.users where id = $1', [manager]);
    assert.equal((await journal())[0].auteur_identifiant, 'gerant@example.test', 'Trace conservée après suppression de l’auteur');

    await db.exec('set role anon');
    await assert.rejects(db.exec('select * from historique_modifications'), /permission denied/);
    await db.exec('reset role');
    await db.query('delete from etablissements where id = $1', [etab]);
    assert.ok((await journal()).every(l => l.etablissement_id === otherEtab), 'Suppression établissement/cascade compatible, pas de fuite de journal');
  } finally {
    await db.close();
  }
});
