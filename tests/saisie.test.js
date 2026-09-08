import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { createServer } from 'vite';
import { SECTEURS_IDS, postesDuSecteur } from '../secteurs.js';

// Vite transforme le JSX réel sans lancer de serveur HTTP ni contacter Supabase.
test('Saisie : 200 boutons, préremplissage, enregistrement et séparation vente/dépense', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { Saisie } = await vite.ssrLoadModule('/App.jsx');
    for (const secteur of SECTEURS_IDS) {
      const enregistrements = [];
      let vue;
      await act(async () => {
        vue = create(React.createElement(Saisie, {
          secteur, etablissement: { id: secteur }, t: cle => cle,
          onAdd: async tx => { enregistrements.push(tx); return true; },
        }));
      });
      const bouton = label => vue.root.findAllByType('button').find(b => b.children.includes(label));
      await act(async () => bouton('saisie_depense').props.onClick());
      assert.equal(vue.root.findByType('datalist').findAllByType('option').length, 20);
      for (const poste of postesDuSecteur(secteur)) {
        assert.ok(bouton(poste.label), `${secteur}: ${poste.label} visible`);
        await act(async () => bouton(poste.label).props.onClick());
        assert.equal(vue.root.findByProps({ list: 'comptaci-postes' }).props.value, poste.label);
        assert.equal(vue.root.findByType('select').props.value, poste.categorie);
        assert.equal(vue.root.findByProps({ placeholder: '1' }).props.value, '1');
        assert.equal(vue.root.findByProps({ placeholder: '0' }).props.value, '');
      }
      assert.equal(enregistrements.length, 0, 'Sélectionner ne crée aucune transaction');
      const dernierPoste = postesDuSecteur(secteur).at(-1);
      await act(async () => vue.root.findByProps({ placeholder: '0' }).props.onChange({ target: { value: '2500' } }));
      await act(async () => bouton('saisie_enregistrer').props.onClick());
      assert.equal(enregistrements.length, 1);
      assert.equal(enregistrements[0].designation, dernierPoste.label);
      assert.equal(enregistrements[0].poste_id, dernierPoste.id);
      assert.equal(enregistrements[0].categorie, dernierPoste.categorie);
      assert.equal(enregistrements[0].montant, 2500);
      assert.equal(enregistrements[0].type, 'depense');
      await act(async () => bouton(dernierPoste.label).props.onClick());
      await act(async () => vue.root.findByType('select').props.onChange({ target: { value: 'autre' } }));
      await act(async () => vue.root.findByProps({ placeholder: '0' }).props.onChange({ target: { value: '1000' } }));
      await act(async () => bouton('saisie_enregistrer').props.onClick());
      assert.equal(enregistrements[1].categorie, 'autre', 'Catégorie manuelle respectée');
      assert.equal(enregistrements[1].poste_id, null);
      await act(async () => bouton(dernierPoste.label).props.onClick());
      await act(async () => bouton('saisie_vente').props.onClick());
      assert.equal(vue.root.findAllByType('datalist').length, 0);
      assert.equal(vue.root.findByProps({ type: 'text' }).props.value, '');
      await act(async () => vue.unmount());
    }
  } finally {
    await vite.close();
  }
});
