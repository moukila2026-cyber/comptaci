import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIX_FNE_ANNUEL,
  COUT_KOMPTO_ANNUEL,
  MARGE_FNE_ANNUELLE,
  DUREE_OPTION_FNE_MOIS,
  FNE_CHOIX,
  FNE_STATUTS,
  choixSelonCompteDgi,
  choixCoherent,
  choixPayant,
  choixViaKompto,
  statutPourChoix,
  champsRequis,
  normaliserCompteDgi,
  normaliserChoix,
  normaliserStatut,
  normaliserIdentifiant,
  nccCanonique,
  nccValideForme,
  prochaineExpiration,
  optionValide,
  joursAvantExpiration,
  renouvellementProche,
  identifiantsKomptoComplets,
  droitFne,
  suggereActiverFne,
  recapitulatifTarifFne,
} from '../fneOption.js';

/* ---------------------------------------------------------------- tarifs */

test("l'option FNE vaut 100 000 FCFA/an et la marge est calculée, pas ressaisie", () => {
  assert.equal(PRIX_FNE_ANNUEL, 100000);
  assert.equal(COUT_KOMPTO_ANNUEL, 80000);
  assert.equal(MARGE_FNE_ANNUELLE, 20000);
  assert.equal(DUREE_OPTION_FNE_MOIS, 12);
  const r = recapitulatifTarifFne();
  assert.equal(r.margeAnnuelle, r.prixAnnuel - r.coutKomptoAnnuel);
  assert.equal(r.facturation, 'avance_annuelle');
});

/* ---------------------------------------------------- arbre de décision */

test('les secondes options dépendent de la réponse à la question 1', () => {
  assert.deepEqual(choixSelonCompteDgi('non'), ['creer', 'sans_fne']);
  assert.deepEqual(choixSelonCompteDgi('oui'), ['connecter', 'methode_actuelle']);
  // Une réponse non reconnue ne doit pas proposer de choix par accident.
  assert.deepEqual(choixSelonCompteDgi(null), ['creer', 'sans_fne']);
});

test('un choix incohérent avec la question 1 est détecté', () => {
  assert.ok(choixCoherent('non', 'creer'));
  assert.ok(choixCoherent('non', 'sans_fne'));
  assert.ok(choixCoherent('oui', 'connecter'));
  assert.ok(choixCoherent('oui', 'methode_actuelle'));
  assert.equal(choixCoherent('non', 'connecter'), false);
  assert.equal(choixCoherent('oui', 'creer'), false);
});

test('seuls « creer » et « connecter » font payer l’option', () => {
  for (const c of FNE_CHOIX) {
    assert.equal(choixPayant(c), c === 'creer' || c === 'connecter', c);
    assert.equal(choixViaKompto(c), c === 'creer' || c === 'connecter', c);
  }
});

test('« sans_fne » et « methode_actuelle » restent au statut aucune', () => {
  assert.equal(statutPourChoix('creer'), 'en_cours');
  assert.equal(statutPourChoix('connecter'), 'en_cours');
  assert.equal(statutPourChoix('sans_fne'), 'aucune');
  assert.equal(statutPourChoix('methode_actuelle'), 'aucune');
});

test('« connecter » exige les 3 identifiants, « creer » aucun', () => {
  // Le commerçant a déjà son compte FNE : il SAISIT ses identifiants existants.
  assert.deepEqual(champsRequis('connecter'), ['establishment', 'pointOfSale', 'ncc']);
  // KOMPTO crée le compte, l'établissement et le point de vente : rien à saisir.
  assert.deepEqual(champsRequis('creer'), []);
  assert.deepEqual(champsRequis('sans_fne'), []);
  assert.deepEqual(champsRequis('methode_actuelle'), []);
});

/* -------------------------------------------------------- normalisation */

test('les saisies sont normalisées, les valeurs inconnues ne deviennent pas « non »', () => {
  assert.equal(normaliserCompteDgi('OUI'), 'oui');
  assert.equal(normaliserCompteDgi(' non '), 'non');
  assert.equal(normaliserCompteDgi('yes'), 'oui');
  // Une réponse absente reste absente : on ne fait pas dire au commerçant
  // qu'il n'a pas de compte FNE.
  assert.equal(normaliserCompteDgi(null), null);
  assert.equal(normaliserCompteDgi('peut-etre'), null);

  assert.equal(normaliserChoix('CREER'), 'creer');
  assert.equal(normaliserChoix('sans-fne'), 'sans_fne');
  assert.equal(normaliserChoix('methode actuelle'), 'methode_actuelle');
  assert.equal(normaliserChoix('nimporte'), null);

  assert.equal(normaliserStatut('en cours'), 'en_cours');
  assert.equal(normaliserStatut('bizarre'), 'aucune');
  assert.equal(normaliserStatut(null), 'aucune');
});

test('les identifiants KOMPTO conservent leur casse, les vides deviennent null', () => {
  assert.equal(normaliserIdentifiant('  8200001A '), '8200001A');
  assert.equal(normaliserIdentifiant('   '), null);
  assert.equal(normaliserIdentifiant(undefined), null);
});

test('le NCC est canonisé et contrôlé en forme (7 chiffres + lettre)', () => {
  // Format calé sur « 8200001A », l'exemple officiel publié par KOMPTO.
  assert.equal(nccCanonique(' 820-0001-a '), '8200001A');
  assert.ok(nccValideForme('8200001A'));
  assert.ok(nccValideForme(' 8200001a '));
  assert.ok(nccValideForme('1234567Z'));
  assert.equal(nccValideForme('820001A'), false);       // 6 chiffres
  assert.equal(nccValideForme('82000001A'), false);     // 8 chiffres
  assert.equal(nccValideForme('82000011'), false);      // pas de lettre
  assert.equal(nccValideForme('8200001AB'), false);     // 2 lettres
  assert.equal(nccValideForme(''), false);
  assert.equal(nccValideForme(null), false);
});

/* ---------------------------------------------------- échéance annuelle */

test('un renouvellement anticipé s’ajoute à l’échéance, sans perdre les jours payés', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  // Option encore valable 3 mois → on ajoute 12 mois à l'échéance en cours.
  const fin = prochaineExpiration('2026-12-31', now);
  assert.equal(fin.toISOString().slice(0, 10), '2027-12-31');
});

test('un renouvellement après expiration repart de la date du jour', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  assert.equal(prochaineExpiration('2026-01-15', now).toISOString().slice(0, 10), '2027-09-25');
  assert.equal(prochaineExpiration(null, now).toISOString().slice(0, 10), '2027-09-25');
});

test('le 29 février ne dérive pas sur un renouvellement annuel', () => {
  const now = new Date('2028-02-29T00:00:00Z');
  assert.equal(prochaineExpiration(null, now).toISOString().slice(0, 10), '2029-02-28');
});

test('l’expiration est inclusive : l’option couvre toute la journée d’échéance', () => {
  assert.ok(optionValide({ fne_expiration_date: '2026-09-25' }, new Date('2026-09-25T23:00:00Z')));
  assert.equal(optionValide({ fne_expiration_date: '2026-09-25' }, new Date('2026-09-26T00:00:01Z')), false);
  assert.equal(optionValide({ fne_expiration_date: null }, new Date('2026-09-25T00:00:00Z')), false);
  assert.equal(optionValide({ fne_expiration_date: 'pas-une-date' }, new Date('2026-09-25T00:00:00Z')), false);
});

test('l’alerte de renouvellement se déclenche à 30 jours', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  assert.equal(joursAvantExpiration({ fne_expiration_date: '2026-10-10' }, now), 15);
  assert.ok(renouvellementProche({ fne_expiration_date: '2026-10-10' }, now));
  assert.equal(renouvellementProche({ fne_expiration_date: '2027-09-25' }, now), false);
  // Expirée depuis longtemps → 0 jour restant, et toujours une alerte.
  assert.equal(joursAvantExpiration({ fne_expiration_date: '2020-01-01' }, now), 0);
  assert.equal(joursAvantExpiration({ fne_expiration_date: null }, now), null);
});

/* --------------------------------------------------------- droit d'usage */

const IDENTIFIANTS = {
  fne_establishment: 'ETAB-001',
  fne_point_of_sale: 'POS-001',
  fne_ncc: '8200001A',
};

/** Établissement pleinement opérationnel. */
const etabOperationnel = (extra = {}) => ({
  id: 'e1',
  fne_compte_dgi: 'oui',
  fne_choix: 'connecter',
  fne_statut: 'active',
  fne_expiration_date: '2027-09-25',
  ...IDENTIFIANTS,
  ...extra,
});

test('REGRESSION COMMERCIALE : la FNE est disponible sur TOUS les plans, Fondateur compris', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  // Le forfait ne doit JAMAIS entrer dans la décision. C'est la règle
  // commerciale explicite, et elle remplace l'ancien verrou Pro/Entreprise.
  for (const plan of ['starter', 'pro', 'entreprise', undefined, 'inconnu']) {
    for (const est_fondateur of [true, false]) {
      const d = droitFne(etabOperationnel({ plan, est_fondateur }), now);
      assert.equal(
        d.peutCertifier,
        true,
        `la FNE doit être accessible en plan=${plan} fondateur=${est_fondateur}`
      );
      assert.equal(d.raison, null);
    }
  }
});

test('un Fondateur au tarif verrouillé 7000 FCFA garde l’accès FNE', () => {
  const fondateur = etabOperationnel({
    plan: 'starter',
    est_fondateur: true,
    tarif_verrouille: 7000,
    abonnement_actif: false,
    date_creation: '2026-09-20T00:00:00Z',
    essai_jours: 14,
  });
  assert.equal(droitFne(fondateur, new Date('2026-09-25T00:00:00Z')).peutCertifier, true);
});

test('chaque condition manquante produit une raison explicite', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  const cas = [
    [{}, 'choix_absent'],
    [{ fne_choix: 'sans_fne' }, 'sans_fne'],
    [{ fne_choix: 'methode_actuelle' }, 'methode_externe'],
    [{ fne_choix: 'connecter', fne_expiration_date: null }, 'option_non_payee'],
    [{ fne_choix: 'creer', fne_expiration_date: '2020-01-01' }, 'option_expiree'],
    [
      { fne_choix: 'creer', fne_expiration_date: '2027-01-01', fne_statut: 'en_cours' },
      'parcours_en_cours',
    ],
    [
      { fne_choix: 'connecter', fne_expiration_date: '2027-01-01', fne_statut: 'active', fne_ncc: null,
        fne_establishment: 'E', fne_point_of_sale: 'P' },
      'identifiants_manquants',
    ],
  ];
  for (const [extra, attendu] of cas) {
    const d = droitFne({ id: 'e1', ...extra }, now);
    assert.equal(d.peutCertifier, false, JSON.stringify(extra));
    assert.equal(d.raison, attendu, JSON.stringify(extra));
  }
});

test('un établissement « sans FNE » ou « méthode actuelle » n’est pas harcelé', () => {
  const now = new Date('2026-09-25T00:00:00Z');
  assert.equal(suggereActiverFne({ id: 'e1', fne_choix: 'sans_fne' }, now), false);
  assert.equal(suggereActiverFne({ id: 'e1', fne_choix: 'methode_actuelle' }, now), false);
  // Parcours lancé mais non payé → on invite à finaliser.
  assert.equal(suggereActiverFne({ id: 'e1', fne_choix: 'creer', fne_statut: 'en_cours' }, now), true);
  assert.equal(suggereActiverFne(etabOperationnel(), now), false);
});

test('les trois identifiants doivent tous être présents', () => {
  assert.ok(identifiantsKomptoComplets(IDENTIFIANTS));
  assert.equal(identifiantsKomptoComplets({ ...IDENTIFIANTS, fne_point_of_sale: ' ' }), false);
  assert.equal(identifiantsKomptoComplets({ ...IDENTIFIANTS, fne_ncc: null }), false);
  assert.equal(identifiantsKomptoComplets({}), false);
  assert.equal(identifiantsKomptoComplets(null), false);
});

test('le vocabulaire reste aligné sur la base de données', () => {
  assert.deepEqual(FNE_STATUTS, ['aucune', 'en_cours', 'active']);
  assert.deepEqual(FNE_CHOIX, ['creer', 'connecter', 'sans_fne', 'methode_actuelle']);
});
