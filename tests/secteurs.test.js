import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTEURS_IDS, postesDuSecteur, produitsDuSecteur, categoriesDuSecteur,
  categoriesHistoriquesDuSecteur, posteDeDesignation, categorieSuggeree,
  libellePoste, natureCategorie, normaliser,
} from '../secteurs.js';
import { ANCIENS_SECTEURS } from '../anciensPostes.js';

for (const secteur of SECTEURS_IDS) {
  test(`${secteur} : 20 frais distincts, classés et préremplissables`, () => {
    const postes = postesDuSecteur(secteur);
    const categories = categoriesDuSecteur(secteur).map(c => c.id);
    assert.equal(postes.length, 20);
    assert.equal(new Set(postes.map(p => p.id)).size, 20);
    assert.equal(new Set(postes.map(p => normaliser(p.label))).size, 20);
    for (const p of postes) {
      assert.ok(categories.includes(p.categorie), p.label);
      assert.ok(['charges', 'personnel'].includes(natureCategorie(p.categorie)), p.label);
      assert.equal(posteDeDesignation(secteur, p.label)?.id, p.id);
      assert.equal(categorieSuggeree(secteur, p.label), p.categorie);
      assert.equal(posteDeDesignation(secteur, normaliser(p.label).toUpperCase())?.id, p.id);
      assert.equal(p.montant, undefined); // Aucune écriture / montant fictif.
      assert.ok(!ANCIENS_SECTEURS[secteur].postes.some(ancien => ancien.id === p.id));
    }
  });

  test(`${secteur} : stock séparé, sans frais de fonctionnement`, () => {
    const produits = produitsDuSecteur(secteur);
    assert.ok(produits.length > 0);
    assert.equal(new Set(produits.map(p => p.id)).size, produits.length);
    const depenses = postesDuSecteur(secteur);
    for (const p of produits) {
      assert.ok(!depenses.some(d => d.id === p.id || d.label === p.label), p.label);
      assert.equal(posteDeDesignation(secteur, p.label), null, p.label);
      assert.doesNotMatch(p.label, /salaires|loyer|facture|gardiennage|maintenance|abonnement/i);
    }
  });

  test(`${secteur} : anciens libellés et catégories conservés pour l’historique`, () => {
    for (const ancien of ANCIENS_SECTEURS[secteur].postes) {
      assert.equal(libellePoste(secteur, ancien.id), ancien.label);
      assert.ok(categoriesHistoriquesDuSecteur(secteur).some(c => c.id === ancien.categorie));
    }
  });
}

test('quincaillerie : les matériaux sont dans le stock, pas dans les dépenses', () => {
  for (const id of ['ciment', 'fer', 'toles', 'bois', 'peinture_prod', 'pinceaux', 'clous']) {
    assert.ok(produitsDuSecteur('quincaillerie').some(p => p.id === id));
    assert.ok(!postesDuSecteur('quincaillerie').some(p => p.id === id));
  }
  for (const label of ['Ciment', 'Fer à béton', 'Tôle bac', 'Clous et vis', 'Peinture']) {
    assert.equal(posteDeDesignation('quincaillerie', label), null);
  }
});

test('alias et fallback bénéficient des nouveaux catalogues', () => {
  for (const [alias, secteur] of [['quincaillerie_general', 'quincaillerie'], ['coiffure', 'salon_beaute'], ['alimentation', 'boutique'], ['restauration', 'restaurant'], ['inconnu', 'restaurant']]) {
    assert.deepEqual(postesDuSecteur(alias), postesDuSecteur(secteur));
    assert.deepEqual(produitsDuSecteur(alias), produitsDuSecteur(secteur));
  }
});

test('saisie libre : détection précise et repli sans faux rapprochement produit', () => {
  assert.equal(posteDeDesignation('quincaillerie', 'Paiement du loyer septembre')?.id, 'fonctionnement_loyer');
  assert.equal(posteDeDesignation('boutique', 'Facture CIE septembre')?.id, 'fonctionnement_electricite');
  assert.equal(posteDeDesignation('boutique', 'Eau de Javel'), null);
  assert.equal(posteDeDesignation('boutique', 'Eau minérale'), null);
  assert.equal(categorieSuggeree('quincaillerie', 'Dépense exceptionnelle'), 'autre');
  assert.equal(posteDeDesignation('quincaillerie', ''), null);
});
