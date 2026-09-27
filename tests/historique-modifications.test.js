import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createServer } from 'vite';
import { champsModifies, valeurHistorique } from '../historiqueModifications.js';
import { traducteur } from '../i18n.js';

const evenement = (id = 'evt-1') => ({
  id, cree_le: '2026-09-27T10:00:00Z', auteur_identifiant: 'gerant@example.test',
  auteur_id: 'gerant-1', auteur_role: 'gerant', entite: 'transactions',
  enregistrement_id: 'tx-1', action: 'UPDATE',
  avant: { montant: 1000, note: 'Vente de riz', quantite: 2 },
  apres: { montant: 1500, note: 'Vente de riz', quantite: 2 },
});
const texte = vue => JSON.stringify(vue.toJSON());
const bouton = (vue, label) => vue.root.findAllByType('button').find(b => b.children.includes(label));
function fauxClient(repondre) {
  const appels = [];
  return {
    appels,
    from(table) {
      const appel = { table, filtres: [], ordre: [] };
      appels.push(appel);
      const requete = {
        select(colonnes) { appel.colonnes = colonnes; return requete; },
        eq(champ, valeur) { appel.filtres.push([champ, valeur]); return requete; },
        order(champ, options) { appel.ordre.push([champ, options]); return requete; },
        range(debut, fin) { appel.plage = [debut, fin]; return repondre(appel); },
      };
      return requete;
    },
  };
}

test('Journal : différences, montants, zéros et traductions', () => {
  assert.deepEqual(champsModifies(evenement()), ['montant']);
  assert.deepEqual(champsModifies({ action: 'DELETE', avant: { montant: 1000, note: 'test' }, apres: null }), ['montant', 'note']);
  assert.deepEqual(champsModifies({ action: 'INSERT', avant: null, apres: { quantite: 0 } }), ['quantite']);
  const t = traducteur('fr');
  assert.equal(valeurHistorique(0, 'montant', 'fr', t), '0 FCFA');
  assert.equal(valeurHistorique(-500, 'ecart', 'fr', t), '-500 FCFA');
  assert.equal(valeurHistorique(null, 'note', 'fr', t), '—');
  assert.equal(valeurHistorique(false, 'abonnement_actif', 'fr', t), 'Non');
  assert.equal(valeurHistorique('vente', 'type', 'fr', t), 'Vente');
  for (const langue of ['fr', 'en', 'ar']) {
    assert.notEqual(traducteur(langue)('nav_modifications'), 'nav_modifications');
    assert.notEqual(traducteur(langue)('audit_champ_quantite_stock'), 'audit_champ_quantite_stock');
  }
});

test('Journal UI : propriétaire seulement, filtres, pagination, erreurs et changement de compte', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  let vue;
  try {
    const { default: Journal } = await vite.ssrLoadModule('/HistoriqueModifications.jsx');
    const { Sidebar } = await vite.ssrLoadModule('/App.jsx');
    const t = traducteur('fr');
    for (const isMobile of [false, true]) {
      for (const role of ['proprietaire', 'gerant', null]) {
        await act(async () => { vue = create(React.createElement(Sidebar, { role, isMobile, t, setVue() {}, onLogout() {} })); });
        assert.equal(texte(vue).includes('Historique des modifications'), role === 'proprietaire');
        assert.ok(texte(vue).includes('Historique'), 'L’historique des mouvements reste accessible');
        await act(async () => vue.unmount());
      }
    }

    let reponse = { data: Array.from({ length: 26 }, (_, i) => evenement(`evt-${i}`)) };
    const client = fauxClient(() => Promise.resolve(reponse));
    const props = { role: 'gerant', etablissementId: 'etab-a', client, t };
    await act(async () => { vue = create(React.createElement(Journal, props)); });
    assert.equal(vue.toJSON(), null);
    assert.equal(client.appels.length, 0);
    props.role = 'proprietaire';
    await act(async () => vue.update(React.createElement(Journal, props)));
    assert.equal(client.appels.length, 1);
    assert.deepEqual(client.appels[0].filtres, [['etablissement_id', 'etab-a']]);
    assert.deepEqual(client.appels[0].plage, [0, 25]);
    assert.deepEqual(client.appels[0].ordre, [['cree_le', { ascending: false }], ['id', { ascending: false }]]);
    assert.equal(vue.root.findAllByType('li').length, 25);
    assert.ok(texte(vue).includes('gerant@example.test'));
    assert.ok(texte(vue).includes('Gérant'));
    assert.ok(texte(vue).includes('1 500 FCFA'));
    assert.equal(vue.root.findAllByType('tbody')[0].findAllByType('tr').length, 1, 'Seul le montant modifié est détaillé');
    assert.equal(bouton(vue, 'Suivant').props.disabled, false);
    reponse = { data: [evenement()] };
    await act(async () => bouton(vue, 'Suivant').props.onClick());
    assert.deepEqual(client.appels.at(-1).plage, [25, 50]);
    assert.equal(bouton(vue, 'Suivant').props.disabled, true);
    assert.equal(bouton(vue, 'Précédent').props.disabled, false);
    await act(async () => vue.root.findAllByType('select')[0].props.onChange({ target: { value: 'produits' } }));
    assert.deepEqual(client.appels.at(-1).plage, [0, 25], 'Un filtre revient à la première page');
    assert.ok(client.appels.at(-1).filtres.some(([c, v]) => c === 'entite' && v === 'produits'));
    reponse = { data: [] };
    await act(async () => vue.root.findAllByType('select')[1].props.onChange({ target: { value: 'DELETE' } }));
    assert.ok(client.appels.at(-1).filtres.some(([c, v]) => c === 'action' && v === 'DELETE'));
    assert.ok(texte(vue).includes('Aucune modification ne correspond'));
    reponse = { error: { code: 'PGRST205' } };
    await act(async () => bouton(vue, 'Actualiser').props.onClick());
    assert.ok(texte(vue).includes('supabase-historique-modifications.sql'));
    reponse = { error: { message: 'network failure' } };
    await act(async () => bouton(vue, 'Réessayer').props.onClick());
    assert.ok(texte(vue).includes('Impossible de charger'));
    reponse = { data: [] };
    await act(async () => bouton(vue, 'Réessayer').props.onClick());
    assert.equal(vue.root.findAllByProps({ role: 'alert' }).length, 0);
    await act(async () => vue.update(React.createElement(Journal, { ...props, role: 'gerant' })));
    assert.equal(vue.toJSON(), null);
    await act(async () => vue.unmount());

    const attentes = [];
    const lent = fauxClient(() => new Promise(resolve => attentes.push(resolve)));
    await act(async () => { vue = create(React.createElement(Journal, { ...props, client: lent })); });
    assert.ok(texte(vue).includes('Chargement'));
    await act(async () => vue.update(React.createElement(Journal, { ...props, client: lent, etablissementId: 'etab-b' })));
    assert.deepEqual(lent.appels.at(-1).filtres, [['etablissement_id', 'etab-b']]);
    await act(async () => attentes[1]({ data: [] }));
    await act(async () => attentes[0]({ data: [evenement()] }));
    assert.ok(!texte(vue).includes('gerant@example.test'), 'La réponse tardive de A ne fuit pas dans B');
    assert.ok(texte(vue).includes('Aucune modification enregistrée'));
    await act(async () => vue.unmount());
  } finally {
    if (vue) await act(async () => vue.unmount());
    await vite.close();
  }
});
