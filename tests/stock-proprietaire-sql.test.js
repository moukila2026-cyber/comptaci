import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Vrai moteur PostgreSQL embarqué : RLS, SECURITY DEFINER, GRANT et triggers.
// Les scripts de production sont exécutés tels quels ; seule l'extension
// pgcrypto (absente de PGlite, et inutile : gen_random_uuid() est natif) est retirée.

const proprietaireA = '00000000-0000-0000-0000-0000000000a1';
const proprietaireB = '00000000-0000-0000-0000-0000000000b1';
const gerant = '00000000-0000-0000-0000-0000000000c1';
const intrus = '00000000-0000-0000-0000-0000000000d1';

const lire = (fichier) => readFile(new URL(`../${fichier}`, import.meta.url), 'utf8');
const setupFinal = async () => (await lire('supabase-SETUP-FINAL.sql')).replace('create extension if not exists pgcrypto;', '');

async function nouvelleBase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, phone text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users (id, email) values
      ('${proprietaireA}', 'proprietaire-a@example.test'),
      ('${proprietaireB}', 'proprietaire-b@example.test'),
      ('${gerant}', 'gerant@example.test'),
      ('${intrus}', 'intrus@example.test');
  `);
  return db;
}

/** Exécute du SQL d'administration (scripts de migration) hors de tout rôle applicatif. */
async function administrer(db, sql) {
  await db.exec('reset role');
  await db.exec(sql);
}

async function connecter(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  await db.exec(id === null ? 'set role anon' : 'set role authenticated');
}

/** Exécute une requête et renvoie les lignes, le nombre de lignes touchées ou l'erreur. */
async function essayer(db, sql, params = []) {
  try {
    const r = await db.query(sql, params);
    return { lignes: r.rows, nb: r.affectedRows };
  } catch (e) {
    return { erreur: e.message };
  }
}

/** Accorde les droits de table comme Supabase (la RLS reste le filtre réel). */
async function accorderTables(db) {
  await db.exec(`
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
  `);
}

/** Crée l'établissement A (propriétaire), ses produits, puis fait rejoindre le gérant. */
async function etablissementAvecGerant(db) {
  await connecter(db, proprietaireB);
  const { rows: [etabB] } = await db.query(`select * from creer_etablissement('Boutique B', 'boutique', '')`);
  await connecter(db, proprietaireA);
  const { rows: [etab] } = await db.query(`select * from creer_etablissement('Boutique A', 'boutique', '0700000000')`);
  await db.query(
    `insert into produits (etablissement_id, designation, quantite_stock, prix_unitaire)
     values ($1, 'Savon', 10, 350), ($1, 'Riz', 5, null)`,
    [etab.id],
  );
  await connecter(db, gerant);
  await db.query(`insert into membres (etablissement_id, user_id, role) values ($1, $2, 'gerant')`, [etab.id, gerant]);
  return { etab, etabB };
}

const quantite = async (db, etabId, designation) => {
  const { rows } = await db.query(
    'select quantite_stock from produits where etablissement_id = $1 and designation = $2',
    [etabId, designation],
  );
  return rows[0] ? Number(rows[0].quantite_stock) : null;
};

const politiques = async (db) => (await db.query(
  `select tablename, policyname, cmd, qual, with_check
     from pg_policies
    where schemaname = 'public' and tablename in ('produits', 'transactions', 'fournisseurs')
    order by tablename, policyname`,
)).rows;

const declencheurs = async (db) => (await db.query(
  `select tgname, pg_get_triggerdef(oid) as definition
     from pg_trigger
    where tgrelid = 'public.transactions'::regclass and not tgisinternal
    order by tgname`,
)).rows;

const definitionMouvement = async (db) => (await db.query(
  `select prosrc from pg_proc where proname = 'appliquer_mouvement_stock'`,
)).rows[0]?.prosrc;

test('SETUP-FINAL : le gérant consulte et saisit, mais ne crée, ne modifie ni ne supprime aucun produit', async () => {
  const db = await nouvelleBase();
  try {
    await db.exec(await setupFinal());
    await db.exec(await setupFinal()); // relancé tel quel : idempotent, les droits restent les mêmes
    await accorderTables(db);
    const { etab, etabB } = await etablissementAvecGerant(db);

    // Lecture : le stock reste visible pour tous les membres.
    assert.equal((await db.query('select count(*)::int as n from produits where etablissement_id = $1', [etab.id])).rows[0].n, 2);

    // Écritures directes refusées par la base (insertion) ou sans effet (modification, suppression).
    const insertion = await essayer(db, `insert into produits (etablissement_id, designation, quantite_stock) values ($1, 'Eau de Javel', 3)`, [etab.id]);
    assert.match(insertion.erreur, /row-level security/);
    assert.equal((await essayer(db, `update produits set quantite_stock = 999 where designation = 'Savon'`)).nb, 0);
    assert.equal((await essayer(db, `update produits set seuil_alerte = 50 where designation = 'Savon'`)).nb, 0);
    assert.equal((await essayer(db, `delete from produits where designation = 'Savon'`)).nb, 0);
    assert.equal(await quantite(db, etab.id, 'Savon'), 10, 'Le stock n’a pas bougé');

    // Mouvements : saisie et correction autorisées, suppression refusée.
    const { rows: [vente] } = await db.query(
      `insert into transactions (etablissement_id, type, montant, note)
       values ($1, 'vente', 700, 'Savon — Qté: 2') returning id`,
      [etab.id],
    );
    assert.equal((await essayer(db, 'update transactions set montant = 800 where id = $1', [vente.id])).nb, 1);
    assert.equal((await essayer(db, 'update transactions set note = $2 where id = $1', [vente.id, 'Savon — Qté: 2 (corrigé)'])).nb, 1);
    assert.match((await essayer(db, `update transactions set type = 'depense' where id = $1`, [vente.id])).erreur, /seulement corriger le montant et la note/);
    assert.match((await essayer(db, `update transactions set date = '2020-01-01' where id = $1`, [vente.id])).erreur, /seulement corriger le montant et la note/);
    assert.equal((await essayer(db, 'delete from transactions where id = $1', [vente.id])).nb, 0, 'Un gérant ne supprime pas un mouvement');
    assert.equal((await db.query('select count(*)::int as n from transactions where id = $1', [vente.id])).rows[0].n, 1);

    // Fournisseurs : saisie et correction autorisées, suppression refusée.
    const { rows: [fournisseur] } = await db.query(
      `insert into fournisseurs (etablissement_id, nom, telephone) values ($1, 'Diallo SARL', '0700000001') returning id`,
      [etab.id],
    );
    assert.equal((await essayer(db, 'update fournisseurs set note = $1 where id = $2', ['Livraison le lundi', fournisseur.id])).nb, 1);
    assert.equal((await essayer(db, 'delete from fournisseurs where id = $1', [fournisseur.id])).nb, 0, 'Un gérant ne supprime pas un fournisseur');

    // Mouvement → stock : une vente diminue, un achat augmente un produit suivi.
    const vendu = await db.query(`select * from appliquer_mouvement_stock($1, 'savon ', 3, 'vente', null)`, [etab.id]);
    assert.equal(Number(vendu.rows[0].quantite_stock), 7, 'Casse et espaces ignorés');
    const achete = await db.query(`select * from appliquer_mouvement_stock($1, 'SAVON', 2, 'depense', null)`, [etab.id]);
    assert.equal(Number(achete.rows[0].quantite_stock), 9);

    // Un gérant n'ajoute jamais une ligne de stock, même via une dépense.
    const inconnu = await db.query(`select * from appliquer_mouvement_stock($1, 'Eau de Javel', 4, 'depense', 500)`, [etab.id]);
    assert.equal(inconnu.rows.length, 0);
    assert.equal(await quantite(db, etab.id, 'Eau de Javel'), null);
    assert.equal((await db.query(`select * from appliquer_mouvement_stock($1, 'Inconnu', 1, 'vente', null)`, [etab.id])).rows.length, 0);

    // Quantité nulle : aucun effet. Type inconnu : refusé.
    assert.equal((await db.query(`select * from appliquer_mouvement_stock($1, 'Savon', 0, 'vente', null)`, [etab.id])).rows.length, 0);
    assert.equal(await quantite(db, etab.id, 'Savon'), 9);
    assert.match((await essayer(db, `select * from appliquer_mouvement_stock($1, 'Savon', 1, 'suppression', null)`, [etab.id])).erreur, /Type de mouvement inconnu/);

    // Prix unitaire : renseigné seulement s'il manque encore.
    const prixRempli = await db.query(`select * from appliquer_mouvement_stock($1, 'Riz', 1, 'vente', 1200)`, [etab.id]);
    assert.equal(Number(prixRempli.rows[0].prix_unitaire), 1200);
    const prixConserve = await db.query(`select * from appliquer_mouvement_stock($1, 'Riz', 1, 'vente', 1500)`, [etab.id]);
    assert.equal(Number(prixConserve.rows[0].prix_unitaire), 1200);

    // Un gérant ne touche pas aux établissements dont il n'est pas membre.
    assert.match((await essayer(db, `select * from appliquer_mouvement_stock($1, 'Savon', 1, 'vente', null)`, [etabB.id])).erreur, /Accès refusé/);
    assert.match((await essayer(db, `insert into produits (etablissement_id, designation) values ($1, 'Piège')`, [etabB.id])).erreur, /row-level security/);
  } finally {
    await db.close();
  }
});

test('SETUP-FINAL : le propriétaire garde la main sur le stock, les suppressions et la création de lignes', async () => {
  const db = await nouvelleBase();
  try {
    await db.exec(await setupFinal());
    await accorderTables(db);
    const { etab } = await etablissementAvecGerant(db);
    await connecter(db, gerant);
    const mouvement = await db.query(
      `insert into transactions (etablissement_id, type, montant, note) values ($1, 'vente', 500, 'Test') returning id`,
      [etab.id],
    );

    await connecter(db, proprietaireA);
    assert.equal((await db.query('select count(*)::int as n from produits where etablissement_id = $1', [etab.id])).rows[0].n, 2);
    assert.equal((await essayer(db, `update produits set quantite_stock = 12 where designation = 'Savon'`)).nb, 1);
    assert.equal((await essayer(db, `update produits set seuil_alerte = 3 where designation = 'Savon'`)).nb, 1);
    assert.equal((await essayer(db, `insert into produits (etablissement_id, designation, quantite_stock) values ($1, 'Papier', 4)`, [etab.id])).nb, 1);
    assert.equal((await essayer(db, `delete from produits where designation = 'Riz'`)).nb, 1);
    const creation = await db.query(`select * from appliquer_mouvement_stock($1, 'Eau de Javel', 4, 'depense', 500)`, [etab.id]);
    assert.equal(Number(creation.rows[0].quantite_stock), 4, 'Le propriétaire crée une ligne par dépense');
    assert.equal(Number(creation.rows[0].prix_unitaire), 500);

    assert.equal((await essayer(db, `update transactions set type = 'vente', date = '2026-10-01' where id = $1`, [mouvement.rows[0].id])).nb, 1, 'Le propriétaire corrige toutes les colonnes');
    assert.equal((await essayer(db, 'delete from transactions where id = $1', [mouvement.rows[0].id])).nb, 1, 'Le propriétaire supprime un mouvement');
    const fournisseur = await db.query(`insert into fournisseurs (etablissement_id, nom, telephone) values ($1, 'Kone', '0700000002') returning id`, [etab.id]);
    assert.equal((await essayer(db, 'delete from fournisseurs where id = $1', [fournisseur.rows[0].id])).nb, 1, 'Le propriétaire supprime un fournisseur');

    // Le propriétaire de A ne voit ni ne modifie le stock de B.
    await connecter(db, proprietaireB);
    assert.equal((await db.query('select count(*)::int as n from produits where etablissement_id = $1', [etab.id])).rows[0].n, 0);
    assert.equal((await essayer(db, `update produits set quantite_stock = 0 where etablissement_id = $1`, [etab.id])).nb, 0);
    assert.match((await essayer(db, `select * from appliquer_mouvement_stock($1, 'Savon', 1, 'vente', null)`, [etab.id])).erreur, /Accès refusé/);
  } finally {
    await db.close();
  }
});

test('Intrus et anonymes : aucun accès au stock ni à la fonction de mouvement', async () => {
  const db = await nouvelleBase();
  try {
    await db.exec(await setupFinal());
    await accorderTables(db);
    const { etab } = await etablissementAvecGerant(db);

    await connecter(db, intrus);
    assert.equal((await db.query('select count(*)::int as n from produits where etablissement_id = $1', [etab.id])).rows[0].n, 0);
    assert.match((await essayer(db, `insert into produits (etablissement_id, designation) values ($1, 'Piège')`, [etab.id])).erreur, /row-level security/);
    assert.match((await essayer(db, `select * from appliquer_mouvement_stock($1, 'Savon', 1, 'vente', null)`, [etab.id])).erreur, /Accès refusé/);

    // Session authentifiée sans identifiant : refus explicite.
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec('set role authenticated');
    assert.match((await essayer(db, `select * from appliquer_mouvement_stock($1, 'Savon', 1, 'vente', null)`, [etab.id])).erreur, /Authentification requise/);

    // Anonyme : la fonction ne lui est pas accordée.
    await connecter(db, null);
    assert.match((await essayer(db, `select * from appliquer_mouvement_stock($1, 'Savon', 1, 'vente', null)`, [etab.id])).erreur, /permission denied/);
  } finally {
    await db.close();
  }
});

test('Migration sur une base existante : l’ancienne politique est remplacée, sans perte de données, et réexécutable', async () => {
  const db = await nouvelleBase();
  try {
    await db.exec(await setupFinal());
    await accorderTables(db);

    // Remise dans l'état d'une base installée avec les anciennes politiques permissives.
    await administrer(db, `
      drop policy if exists "membres_voient_produits" on produits;
      drop policy if exists "proprietaire_gere_produits" on produits;
      create policy "membres_voient_produits" on produits for select using (est_membre_de(etablissement_id));
      create policy "membres_ecrivent_produits" on produits for all
        using (peut_ecrire_dans(etablissement_id)) with check (peut_ecrire_dans(etablissement_id));

      drop policy if exists "membres_voient_transactions" on transactions;
      drop policy if exists "membres_ajoutent_transactions" on transactions;
      drop policy if exists "membres_modifient_transactions" on transactions;
      drop policy if exists "proprietaire_supprime_transactions" on transactions;
      create policy "membres_voient_transactions" on transactions for select using (est_membre_de(etablissement_id));
      create policy "membres_ecrivent_transactions" on transactions for all
        using (peut_ecrire_dans(etablissement_id)) with check (peut_ecrire_dans(etablissement_id));

      drop policy if exists "membres_voient_fournisseurs" on fournisseurs;
      drop policy if exists "membres_ajoutent_fournisseurs" on fournisseurs;
      drop policy if exists "membres_modifient_fournisseurs" on fournisseurs;
      drop policy if exists "proprietaire_supprime_fournisseurs" on fournisseurs;
      create policy "membres_voient_fournisseurs" on fournisseurs for select using (est_membre_de(etablissement_id));
      create policy "membres_ecrivent_fournisseurs" on fournisseurs for all
        using (peut_ecrire_dans(etablissement_id)) with check (peut_ecrire_dans(etablissement_id));

      -- Politique créée à la main, nom inconnu des scripts : elle doit disparaître elle aussi.
      create policy "politique_creee_a_la_main" on produits for all using (true) with check (true);
    `);
    const { etab } = await etablissementAvecGerant(db);
    await connecter(db, gerant);
    assert.equal((await essayer(db, `update produits set quantite_stock = 999 where designation = 'Savon'`)).nb, 1, 'Avant migration : le gérant modifie le stock');
    await connecter(db, proprietaireA);
    await db.query(`update produits set quantite_stock = 10 where designation = 'Savon'`);
    await db.query(`insert into transactions (etablissement_id, type, montant, note) values ($1, 'vente', 500, 'Test')`, [etab.id]);

    const migration = await lire('supabase-stock-proprietaire.sql');
    await administrer(db, migration);
    await administrer(db, migration);

    const restantes = (await db.query(`select policyname from pg_policies where policyname = 'politique_creee_a_la_main'`)).rows;
    assert.equal(restantes.length, 0, 'Une politique inconnue ne survit pas à la migration');
    await connecter(db, gerant);
    assert.match((await essayer(db, `insert into produits (etablissement_id, designation) values ($1, 'Piège')`, [etab.id])).erreur, /row-level security/);
    assert.equal((await essayer(db, `update produits set quantite_stock = 999 where designation = 'Savon'`)).nb, 0);
    assert.equal((await essayer(db, `delete from produits where designation = 'Savon'`)).nb, 0);
    assert.equal((await essayer(db, `delete from transactions where etablissement_id = $1`, [etab.id])).nb, 0);
    assert.equal((await essayer(db, `delete from fournisseurs where etablissement_id = $1`, [etab.id])).nb, 0);
    assert.match((await essayer(db, `update transactions set type = 'depense' where etablissement_id = $1`, [etab.id])).erreur, /seulement corriger le montant et la note/);
    const vente = await db.query(`select * from appliquer_mouvement_stock($1, 'Savon', 4, 'vente', null)`, [etab.id]);
    assert.equal(Number(vente.rows[0].quantite_stock), 6, 'Les ventes continuent d’ajuster le stock');

    // Les politiques obtenues par migration sont identiques à celles d'une installation neuve.
    await db.exec('reset role');
    const installationNeuve = await nouvelleBase();
    try {
      await installationNeuve.exec(await setupFinal());
      assert.deepEqual(await politiques(db), await politiques(installationNeuve));
      assert.deepEqual(await declencheurs(db), await declencheurs(installationNeuve));
      assert.equal(await definitionMouvement(db), await definitionMouvement(installationNeuve));
    } finally {
      await installationNeuve.close();
    }
  } finally {
    await db.close();
  }
});

test('Journal : l’ajustement de stock fait par un gérant reste tracé avec son rôle', async () => {
  const db = await nouvelleBase();
  try {
    await administrer(db, await setupFinal());
    await administrer(db, await lire('supabase-stock-proprietaire.sql'));
    await administrer(db, await lire('supabase-historique-modifications.sql'));
    await accorderTables(db);
    const { etab } = await etablissementAvecGerant(db);

    await connecter(db, gerant);
    await db.query(`select * from appliquer_mouvement_stock($1, 'Savon', 3, 'vente', null)`, [etab.id]);

    await connecter(db, proprietaireA);
    const lignes = (await db.query(
      `select entite, action, auteur_role, avant, apres from historique_modifications
        where entite = 'produits' and action = 'UPDATE' order by cree_le, id`,
    )).rows;
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].auteur_role, 'gerant');
    assert.equal(Number(lignes[0].avant.quantite_stock), 10);
    assert.equal(Number(lignes[0].apres.quantite_stock), 7);
  } finally {
    await db.close();
  }
});
