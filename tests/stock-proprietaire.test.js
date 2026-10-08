import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createServer } from 'vite';
import { estProprietaire } from '../droits.js';
import { appliquerMouvementStock, fusionnerProduit, parametresMouvementStock } from '../stock.js';
import { traducteur } from '../i18n.js';

const texte = (vue) => JSON.stringify(vue.toJSON());
const boutons = (vue, aria) => vue.root.findAllByType('button').filter((b) => b.props['aria-label'] === aria);

async function avecVite(fn) {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await fn(vite);
  } finally {
    await vite.close();
  }
}

// ---------------------------------------------------------------------------
// Règles pures
// ---------------------------------------------------------------------------

test('Droits : seul le propriétaire gère le stock et supprime', () => {
  assert.equal(estProprietaire('proprietaire'), true);
  for (const role of ['gerant', 'membre', '', null, undefined]) {
    assert.equal(estProprietaire(role), false, `rôle « ${role} » sans droit de gestion`);
  }
});

test('Mouvements : seules les ventes et dépenses avec une quantité positive touchent le stock', () => {
  assert.deepEqual(
    parametresMouvementStock({ designation: '  Savon ', quantite: '3', type: 'vente', prixUnitaire: 0 }),
    { p_designation: 'Savon', p_quantite: 3, p_type: 'vente', p_prix_unitaire: null },
  );
  assert.deepEqual(
    parametresMouvementStock({ designation: 'Riz', quantite: 2, type: 'depense', prixUnitaire: '1200' }),
    { p_designation: 'Riz', p_quantite: 2, p_type: 'depense', p_prix_unitaire: 1200 },
  );
  assert.equal(parametresMouvementStock({ designation: '   ', quantite: 1, type: 'vente' }), null);
  assert.equal(parametresMouvementStock({ designation: undefined, quantite: 1, type: 'vente' }), null);
  assert.equal(parametresMouvementStock({ designation: 'Savon', quantite: 0, type: 'vente' }), null);
  assert.equal(parametresMouvementStock({ designation: 'Savon', quantite: -2, type: 'depense' }), null);
  assert.equal(parametresMouvementStock({ designation: 'Savon', quantite: 1, type: 'suppression' }), null);
});

test('Mouvements : appel de appliquer_mouvement_stock, produit renvoyé, aucun produit ou erreur', async () => {
  const appels = [];
  const client = (reponse) => ({
    rpc: async (nom, params) => {
      appels.push({ nom, params });
      return reponse;
    },
  });

  const ligne = { id: 'p1', designation: 'Savon', quantite_stock: 7 };
  let resultat = await appliquerMouvementStock(client({ data: [ligne], error: null }), 'etab-a', {
    designation: 'savon', quantite: 3, type: 'vente', prixUnitaire: 0,
  });
  assert.deepEqual(resultat, { ok: true, produit: ligne });
  assert.deepEqual(appels[0], {
    nom: 'appliquer_mouvement_stock',
    params: { p_etablissement_id: 'etab-a', p_designation: 'savon', p_quantite: 3, p_type: 'vente', p_prix_unitaire: null },
  });

  // Gérant + produit inconnu : la base ne renvoie aucune ligne, ce n'est pas une erreur.
  resultat = await appliquerMouvementStock(client({ data: [], error: null }), 'etab-a', {
    designation: 'Eau de Javel', quantite: 4, type: 'depense',
  });
  assert.deepEqual(resultat, { ok: true, produit: null });

  // Ligne sans identifiant (NULL SQL) : jamais de produit fantôme.
  resultat = await appliquerMouvementStock(client({ data: [{ id: null }], error: null }), 'etab-a', {
    designation: 'Savon', quantite: 1, type: 'vente',
  });
  assert.deepEqual(resultat, { ok: true, produit: null });

  // Refus de la base : l'erreur est renvoyée telle quelle, pour être affichée.
  const erreur = { message: 'Accès refusé à cet établissement.' };
  resultat = await appliquerMouvementStock(client({ data: null, error: erreur }), 'etab-a', {
    designation: 'Savon', quantite: 1, type: 'vente',
  });
  assert.deepEqual(resultat, { ok: false, erreur });

  // Mouvement sans effet sur le stock : aucun appel réseau.
  appels.length = 0;
  resultat = await appliquerMouvementStock(client({ data: [], error: null }), 'etab-a', {
    designation: 'Savon', quantite: 0, type: 'vente',
  });
  assert.deepEqual(resultat, { ok: true, produit: null });
  assert.equal(appels.length, 0);
});

test('Stock local : un produit renvoyé remplace sa ligne ou s’ajoute, sans doublon', () => {
  const liste = [{ id: 'p1', quantite_stock: 10 }, { id: 'p2', quantite_stock: 2 }];
  assert.deepEqual(fusionnerProduit(liste, { id: 'p1', quantite_stock: 7 }), [
    { id: 'p1', quantite_stock: 7 },
    { id: 'p2', quantite_stock: 2 },
  ]);
  assert.deepEqual(fusionnerProduit(liste, { id: 'p3', quantite_stock: 1 }).map((p) => p.id), ['p1', 'p2', 'p3']);
  assert.equal(fusionnerProduit(liste, null), liste);
});

test('Traductions : les deux nouveaux avis existent en français, anglais et arabe', () => {
  for (const langue of ['fr', 'en', 'ar']) {
    const t = traducteur(langue);
    assert.notEqual(t('stock_lecture_seule'), 'stock_lecture_seule', `stock_lecture_seule (${langue})`);
    assert.notEqual(t('suppression_reservee'), 'suppression_reservee', `suppression_reservee (${langue})`);
  }
});

// ---------------------------------------------------------------------------
// Interface : rendu selon le rôle
// ---------------------------------------------------------------------------

const produitsTest = [
  { id: 'p1', designation: 'Savon', quantite_stock: 10, prix_unitaire: 350, seuil_alerte: 5 },
  { id: 'p2', designation: 'Riz', quantite_stock: 12, prix_unitaire: 900, seuil_alerte: 5 },
];

test('Stock : le gérant consulte le stock sans aucune action de modification', async () => {
  await avecVite(async (vite) => {
    const { Stock } = await vite.ssrLoadModule('/App.jsx');
    const t = traducteur('fr');
    let vue;
    const appels = [];
    const actions = {
      onAdd: async () => { appels.push('add'); return true; },
      onAjuster: async () => { appels.push('ajuster'); },
      onSupprimer: async () => { appels.push('supprimer'); },
      onSeuil: async () => { appels.push('seuil'); },
      onImporterPostes: async () => { appels.push('importer'); return { ok: true, ajoutes: 1 }; },
    };
    await act(async () => {
      vue = create(React.createElement(Stock, { produits: produitsTest, secteur: 'boutique', peutGerer: false, t, ...actions }));
    });

    assert.ok(texte(vue).includes(t('stock_lecture_seule')), 'avis de consultation affiché');
    assert.ok(texte(vue).includes('Savon') && texte(vue).includes('Riz'), 'le stock reste lisible');
    assert.equal(texte(vue).includes(t('stock_ajouter')), false, 'pas de bouton d’ajout');
    assert.equal(texte(vue).includes(t('stock_import_titre')), false, 'pas d’import de postes');
    assert.equal(vue.root.findAllByType('input').length, 0, 'pas de champ modifiable (seuil, formulaire)');
    for (const aria of ['+1', '-1', 'Supprimer']) {
      assert.equal(boutons(vue, aria).length, 0, `pas de bouton « ${aria} »`);
    }
    assert.equal(appels.length, 0);
  });
});

test('Stock : le propriétaire garde toutes les actions, sans avis de consultation', async () => {
  await avecVite(async (vite) => {
    const { Stock } = await vite.ssrLoadModule('/App.jsx');
    const t = traducteur('fr');
    let vue;
    const appels = [];
    await act(async () => {
      vue = create(React.createElement(Stock, {
        produits: produitsTest, secteur: 'boutique', peutGerer: true, t,
        onAdd: async () => true,
        onAjuster: async (id, quantite) => { appels.push(['ajuster', id, quantite]); },
        onSupprimer: async (id) => { appels.push(['supprimer', id]); },
        onSeuil: async (id, seuil) => { appels.push(['seuil', id, seuil]); },
        onImporterPostes: async () => ({ ok: true, ajoutes: 0 }),
      }));
    });

    assert.equal(texte(vue).includes(t('stock_lecture_seule')), false);
    assert.ok(texte(vue).includes(t('stock_ajouter')), 'bouton d’ajout');
    assert.ok(texte(vue).includes(t('stock_import_titre')), 'import des postes');
    assert.equal(vue.root.findAllByType('input').length, 2, 'un seuil d’alerte modifiable par produit');
    assert.equal(boutons(vue, '+1').length, 2);
    assert.equal(boutons(vue, '-1').length, 2);
    assert.equal(boutons(vue, 'Supprimer').length, 2);

    await act(async () => boutons(vue, '+1')[0].props.onClick());
    await act(async () => boutons(vue, 'Supprimer')[1].props.onClick());
    await act(async () => vue.root.findAllByType('input')[0].props.onChange({ target: { value: '7' } }));
    assert.deepEqual(appels, [['ajuster', 'p1', 11], ['supprimer', 'p2'], ['seuil', 'p1', 7]]);
  });
});

test('Historique : suppression réservée au propriétaire, correction du montant toujours possible', async () => {
  await avecVite(async (vite) => {
    const { Historique } = await vite.ssrLoadModule('/App.jsx');
    const t = traducteur('fr');
    const transactions = [
      { id: 'tx1', type: 'vente', montant: 1000, note: 'Savon — Qté: 2 — PU: 350 FCFA', date: '2026-10-07', categorie: 'vente' },
      { id: 'tx2', type: 'depense', montant: 500, note: 'Transport', date: '2026-10-07', categorie: 'transport' },
    ];
    const appels = [];
    const rendre = (peutSupprimer) => act(async () => {
      vue = create(React.createElement(Historique, {
        transactions, plan: 'pro', secteur: 'boutique', t, peutSupprimer,
        onDelete: async (id) => { appels.push(['supprimer', id]); },
        onUpdate: async () => {},
      }));
    });
    let vue;

    await rendre(false);
    assert.ok(texte(vue).includes(t('suppression_reservee')), 'avis affiché au gérant');
    assert.equal(boutons(vue, 'Supprimer').length, 0, 'aucun bouton de suppression');
    // Le gérant corrige le montant : le bouton du montant ouvre toujours l'édition.
    const montantVente = vue.root.findAllByType('button').find((b) => b.props.style?.color === 'var(--cc-vert)');
    await act(async () => montantVente.props.onClick());
    assert.equal(
      vue.root.findAllByType('input').filter((i) => i.props.type === 'number').length,
      1,
      'champ de montant ouvert pour le gérant',
    );
    await act(async () => vue.unmount());

    await rendre(true);
    assert.equal(texte(vue).includes(t('suppression_reservee')), false);
    assert.equal(boutons(vue, 'Supprimer').length, 2);
    await act(async () => boutons(vue, 'Supprimer')[0].props.onClick());
    assert.deepEqual(appels, [['supprimer', 'tx1']]);
  });
});

test('Fournisseurs : suppression réservée au propriétaire ; le gérant peut toujours ajouter', async () => {
  await avecVite(async (vite) => {
    const { Fournisseurs } = await vite.ssrLoadModule('/App.jsx');
    const t = traducteur('fr');
    const fournisseurs = [{ id: 'f1', nom: 'Diallo SARL', telephone: '0700000001', note: 'Livraison lundi' }];
    const appels = [];
    let vue;

    await act(async () => {
      vue = create(React.createElement(Fournisseurs, {
        fournisseurs, t, peutSupprimer: false,
        onAdd: async () => true,
        onSupprimer: async (id) => { appels.push(['supprimer', id]); },
      }));
    });
    assert.ok(texte(vue).includes(t('suppression_reservee')));
    assert.equal(boutons(vue, 'Supprimer').length, 0);
    assert.ok(texte(vue).includes('Diallo SARL'));
    await act(async () => vue.unmount());

    await act(async () => {
      vue = create(React.createElement(Fournisseurs, {
        fournisseurs, t, peutSupprimer: true,
        onAdd: async () => true,
        onSupprimer: async (id) => { appels.push(['supprimer', id]); },
      }));
    });
    assert.equal(texte(vue).includes(t('suppression_reservee')), false);
    assert.equal(boutons(vue, 'Supprimer').length, 1);
    await act(async () => boutons(vue, 'Supprimer')[0].props.onClick());
    assert.deepEqual(appels, [['supprimer', 'f1']]);
  });
});
