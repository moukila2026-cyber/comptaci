import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KOMPTO_ENVIRONNEMENTS,
  KOMPTO_ENDPOINTS,
  ENVIRONNEMENT_PAR_DEFAUT,
  environnementKompto,
  baseUrlKompto,
  urlEndpoint,
  TYPES_CLIENT,
  CODES_TVA,
  CODE_TVA_PAR_DEFAUT,
  codeTvaValide,
  MODES_PAIEMENT,
  modePaiementKompto,
  NOM_CHAMP_ETABLISHMENT,
  NOM_CHAMP_POINT_OF_SALE,
  IDENTIFIANTS_EMPLACEMENT_CONFIRME,
  champsEtablissementKompto,
  construireItemKompto,
  construirePayloadVerify,
  construirePayloadConfirm,
  construirePayloadAvoir,
  construireParamsGet,
  lireKomptoEntryId,
  lireNumeroFiscal,
  lireCertificat,
  normaliserReponseKompto,
  classifierErreur,
  validerFacturePourKompto,
  creerClientKompto,
  NOM_FONCTION_EDGE,
  configurationPretPourProduction,
  diagnosticKompto,
} from '../kompto.js';

/* ---------------------------------------------------------------- fixtures */

const ETAB = {
  id: 'e1',
  nom: 'Boutique Kouassi',
  plan: 'starter',                 // volontairement le plus petit forfait
  est_fondateur: true,
  fne_compte_dgi: 'oui',
  fne_choix: 'connecter',
  fne_statut: 'active',
  fne_expiration_date: '2027-09-25',
  fne_establishment: 'ETAB-001',
  fne_point_of_sale: 'POS-001',
  fne_ncc: '8200001A',
};

const FACTURE = {
  modePaiement: 'espece',
  client: { type: 'B2B', nom: 'KOUAME ET FRERES SARL', ncc: '8200002B', telephone: '2721212121', email: 'c@k.ci' },
  lignes: [
    { designation: 'Prestation de conseil', quantite: 2, prixUnitaire: 50000, codeTva: 'TVA' },
  ],
};

/* ------------------------------------------- 1. contrat confirmé (endpoints) */

test('les 7 endpoints et leurs verbes correspondent au contrat public officiel', () => {
  const attendu = {
    verify: ['POST', '/api/invoice/verify'],
    getVerify: ['GET', '/api/invoice/getVerify'],
    confirm: ['POST', '/api/invoice/confirm'],
    getElectronicInvoice: ['GET', '/api/invoice/getElectronicInvoice'],
    delete: ['DELETE', '/api/invoice/delete'],
    create: ['POST', '/api/invoice/create'],
    createCreditNote: ['POST', '/api/invoice/createCreditNote'],
  };
  assert.deepEqual(Object.keys(KOMPTO_ENDPOINTS).sort(), Object.keys(attendu).sort());
  for (const [action, [methode, chemin]] of Object.entries(attendu)) {
    assert.equal(KOMPTO_ENDPOINTS[action].methode, methode, action);
    assert.equal(KOMPTO_ENDPOINTS[action].chemin, chemin, action);
  }
});

test('sandbox par défaut, production sur app.kompto.com', () => {
  assert.equal(ENVIRONNEMENT_PAR_DEFAUT, 'sandbox');
  assert.equal(environnementKompto(), 'sandbox');
  assert.equal(baseUrlKompto('sandbox'), 'https://qa.kompto.com');
  assert.equal(baseUrlKompto('production'), 'https://app.kompto.com');
  // Une valeur inconnue retombe sur la sandbox : on ne bascule jamais en
  // production par accident.
  assert.equal(environnementKompto('prod-live-hack'), 'sandbox');
  assert.equal(KOMPTO_ENVIRONNEMENTS.sandbox.valeurFiscale, false);
  assert.equal(KOMPTO_ENVIRONNEMENTS.production.valeurFiscale, true);
  assert.equal(
    urlEndpoint('verify', 'production'),
    'https://app.kompto.com/api/invoice/verify'
  );
  assert.throws(() => urlEndpoint('inexistant'), /Action KOMPTO inconnue/);
});

/* ------------------------------------------------ 2. payload /verify (CONFIRMÉ) */

test('le payload /verify reprend exactement la structure du curl officiel', () => {
  const p = construirePayloadVerify({ etablissement: ETAB, facture: FACTURE });
  assert.equal(p.clientType, 'B2B');
  assert.equal(p.clientName, 'KOUAME ET FRERES SARL');
  assert.equal(p.clientNCC, '8200002B');
  assert.equal(p.clientTelephone, '2721212121');
  assert.equal(p.clientEmail, 'c@k.ci');
  assert.equal(p.paymentMethod, 'transfer');
  assert.equal(Array.isArray(p.items), true);
  assert.deepEqual(p.items[0], {
    itemName: 'Prestation de conseil',
    itemQuantity: 2,
    itemUnitPrice: 50000,
    itemTVAName: 'TVA',
  });
});

test('SECURITE FISCALE : aucun montant calculé n’est jamais envoyé à KOMPTO', () => {
  // Le contrat est explicite : « Vous n'envoyez jamais de montants calculés —
  // Kompto et la DGI s'en chargent. » Envoyer un total ferait diverger nos
  // calculs de ceux de la DGI.
  const p = construirePayloadVerify({ etablissement: ETAB, facture: FACTURE });
  const serialise = JSON.stringify(p).toLowerCase();
  for (const interdit of ['montant_ht', 'montantttc', 'montant_ttc', 'totalht', 'totalttc', 'amounttva', 'vatamount']) {
    assert.equal(serialise.includes(interdit), false, interdit);
  }
  for (const ligne of p.items) {
    assert.equal('montantHT' in ligne, false);
    assert.equal('montantTTC' in ligne, false);
    assert.equal('tva' in ligne, false);
    assert.equal('total' in ligne, false);
    // Seuls les 4 champs confirmés (+ remise éventuelle) sont présents.
    for (const cle of Object.keys(ligne)) {
      assert.ok(
        ['itemName', 'itemQuantity', 'itemUnitPrice', 'itemTVAName', 'itemDiscount'].includes(cle),
        `champ inattendu envoyé : ${cle}`
      );
    }
  }
});

test('multi-articles et remise sont transmis sans montant recalculé', () => {
  const p = construirePayloadVerify({
    etablissement: ETAB,
    facture: {
      ...FACTURE,
      lignes: [
        { designation: 'Article A', quantite: 3, prixUnitaire: 1500, codeTva: 'TVA' },
        { designation: 'Article B exonéré', quantite: 1, prixUnitaire: 25000, codeTva: 'TVAE' },
        { designation: 'Article C remisé', quantite: 2, prixUnitaire: 9000, codeTva: 'TVAB', remise: 1000 },
      ],
    },
  });
  assert.equal(p.items.length, 3);
  assert.deepEqual(p.items.map((i) => i.itemTVAName), ['TVA', 'TVAE', 'TVAB']);
  assert.equal(p.items[2].itemDiscount, 1000);
  assert.equal('itemDiscount' in p.items[0], false);
});

test('les prix sont arrondis en francs entiers', () => {
  assert.equal(construireItemKompto({ prixUnitaire: 1500.6 }).itemUnitPrice, 1501);
  assert.equal(construireItemKompto({ prixUnitaire: '2000' }).itemUnitPrice, 2000);
  assert.equal(construireItemKompto({ prixUnitaire: null }).itemUnitPrice, 0);
  // Le code TVA par défaut est le taux normal ivoirien.
  assert.equal(construireItemKompto({}).itemTVAName, CODE_TVA_PAR_DEFAUT);
});

test('le NCC client n’est exigé qu’en B2B, et la devise qu’en B2F', () => {
  const b2c = construirePayloadVerify({
    etablissement: ETAB,
    facture: { ...FACTURE, client: { type: 'B2C', nom: 'Konan Yao' } },
  });
  assert.equal(b2c.clientType, 'B2C');
  assert.equal('clientNCC' in b2c, false);

  const b2f = construirePayloadVerify({
    etablissement: ETAB,
    facture: { ...FACTURE, client: { type: 'B2F', nom: 'ACME Ltd', devise: 'eur', tauxChange: 655.957 } },
  });
  assert.equal(b2f.clientType, 'B2F');
  assert.equal(b2f.currency, 'EUR');
  assert.equal(b2f.exchangeRate, 655.957);

  // Un type de client inconnu retombe sur B2C plutôt que d'être rejeté.
  const inconnu = construirePayloadVerify({
    etablissement: ETAB,
    facture: { ...FACTURE, client: { type: 'ZZZ', nom: 'X' } },
  });
  assert.equal(inconnu.clientType, 'B2C');
});

test('les 4 types de client et les 5 codes TVA sont ceux publiés par KOMPTO', () => {
  assert.deepEqual(Object.keys(TYPES_CLIENT).sort(), ['B2B', 'B2C', 'B2F', 'B2G']);
  assert.equal(TYPES_CLIENT.B2B.nccObligatoire, true);
  assert.equal(TYPES_CLIENT.B2C.nccObligatoire, false);
  assert.equal(TYPES_CLIENT.B2F.deviseObligatoire, true);

  assert.deepEqual(Object.keys(CODES_TVA).sort(), ['TVA', 'TVAB', 'TVAC', 'TVAD', 'TVAE']);
  assert.equal(CODES_TVA.TVA.taux, 18);
  assert.equal(CODES_TVA.TVAB.taux, 9);          // taux réduit
  assert.equal(CODES_TVA.TVAC.taux, 0);
  assert.equal(CODES_TVA.TVAD.taux, 0);
  assert.equal(CODES_TVA.TVAE.taux, 0);
  assert.ok(codeTvaValide('tva'));
  assert.ok(codeTvaValide(' TVAB '));
  assert.equal(codeTvaValide('TVA20'), false);   // cas d'erreur « TVA non reconnue »
  assert.equal(codeTvaValide(''), false);
});

test('un mode de paiement non confirmé retombe sur la seule valeur publiée', () => {
  assert.equal(modePaiementKompto('virement'), 'transfer');
  // Les autres modes existent côté ComptaCi mais leur valeur littérale KOMPTO
  // reste à confirmer (TBD-KOMPTO #6) : on n'invente rien.
  for (const mode of ['espece', 'carte', 'cheque', 'wave', 'orange_money', 'mtn_money', 'differe']) {
    assert.equal(MODES_PAIEMENT[mode].confirme, false, mode);
    assert.equal(modePaiementKompto(mode), 'transfer', mode);
  }
  assert.equal(modePaiementKompto('inconnu'), 'transfer');
  assert.equal(modePaiementKompto(null), 'transfer');
});

/* --------------------------------------- 3. identifiants établissement (TBD #1) */

test('les identifiants établissement sont injectés et marqués non confirmés', () => {
  const champs = champsEtablissementKompto(ETAB);
  assert.equal(champs[NOM_CHAMP_ETABLISHMENT], 'ETAB-001');
  assert.equal(champs[NOM_CHAMP_POINT_OF_SALE], 'POS-001');
  // Tant que le guide v.5.3 n'a pas été lu, on ne prétend pas être prêt.
  assert.equal(IDENTIFIANTS_EMPLACEMENT_CONFIRME, false);
  assert.equal(configurationPretPourProduction().pret, false);
  // Sans les 3 identifiants, on renvoie {} plutôt qu'un payload boiteux.
  assert.deepEqual(champsEtablissementKompto({ ...ETAB, fne_ncc: null }), {});
});

/* ------------------------------------------------------ 4. lecture réponses */

test('le komptoEntryId est retrouvé quel que soit son emplacement (TBD-KOMPTO #3)', () => {
  assert.equal(lireKomptoEntryId({ komptoEntryId: 'K-123' }), 'K-123');
  assert.equal(lireKomptoEntryId({ data: { komptoEntryId: 'K-456' } }), 'K-456');
  assert.equal(lireKomptoEntryId({ entryId: 789 }), '789');
  assert.equal(lireKomptoEntryId({ result: { entryId: 'K-000' } }), 'K-000');
  assert.equal(lireKomptoEntryId('K-brut'), 'K-brut');
  assert.equal(lireKomptoEntryId({}), null);
  assert.equal(lireKomptoEntryId(null), null);
});

test('numéro fiscal et certificat sont extraits de la réponse /confirm', () => {
  const reponse = {
    invoiceNumber: 'CI2026-8200001A-000123',
    certificate: { sticker: 'abc', signature: 'xyz' },
    qrCode: 'https://fne.dgi.gouv.ci/v/abc',
    pdfUrl: 'https://app.kompto.com/f/123.pdf',
  };
  assert.equal(lireNumeroFiscal(reponse), 'CI2026-8200001A-000123');
  const certificat = lireCertificat(reponse);
  assert.ok(certificat);
  assert.equal(certificat.qr, 'https://fne.dgi.gouv.ci/v/abc');
  assert.equal(certificat.pdf, 'https://app.kompto.com/f/123.pdf');
  assert.equal(lireCertificat({}), null);
});

test('une réponse KOMPTO est normalisée en résultat unique, succès comme échec', () => {
  const ok = normaliserReponseKompto({ komptoEntryId: 'K-1' }, { ok: true, statut: 200 });
  assert.equal(ok.ok, true);
  assert.equal(ok.komptoEntryId, 'K-1');
  assert.equal(ok.erreur, null);

  const ko = normaliserReponseKompto(
    { code: 'E_NCC', message: 'Le NCC du client est invalide' },
    { ok: false, statut: 400 }
  );
  assert.equal(ko.ok, false);
  assert.equal(ko.statut, 400);
  assert.equal(ko.codeErreur, 'E_NCC');
  assert.match(ko.erreur, /NCC/);
  assert.equal(classifierErreur(ko.erreur), 'ncc_invalide');

  // Une réponse non-JSON ne doit pas faire planter l'écran de facturation.
  const brut = normaliserReponseKompto('<html>erreur</html>', { ok: false, statut: 502 });
  assert.equal(brut.ok, false);
  assert.ok(brut.erreur);
});

test('les motifs d’erreur couvrent les 2 cas de test obligatoires', () => {
  assert.equal(classifierErreur('Invalid NCC for this taxpayer'), 'ncc_invalide');
  assert.equal(classifierErreur('Le numéro de contribuable est inconnu'), 'ncc_invalide');
  assert.equal(classifierErreur('Unknown VAT code TVAZ'), 'tva_inconnue');
  assert.equal(classifierErreur('code TVA non reconnu'), 'tva_inconnue');
  assert.equal(classifierErreur('Unauthorized: bad api key'), 'authentification');
  assert.equal(classifierErreur('Invoice already confirmed, irreversible'), 'deja_confirmee');
  assert.equal(classifierErreur('something else entirely'), 'inconnue');
});

/* ------------------------------------------------- 5. confirm / avoir / GET */

test('/confirm n’envoie que l’identifiant obtenu au /verify', () => {
  assert.deepEqual(construirePayloadConfirm({ komptoEntryId: 'K-1' }), { komptoEntryId: 'K-1' });
  // Sans identifiant, on retombe sur le payload vérifié plutôt que d'envoyer {}.
  const repli = construirePayloadConfirm({ komptoEntryId: null, payloadVerifie: { clientType: 'B2C' } });
  assert.equal(repli.clientType, 'B2C');
});

test('un avoir référence la facture d’origine confirmée', () => {
  const avoir = construirePayloadAvoir({
    komptoEntryId: 'K-1',
    motif: 'Erreur de quantité',
    lignes: [{ designation: 'Article A', quantite: 1, prixUnitaire: 1500, codeTva: 'TVA' }],
  });
  assert.equal(avoir.originalKomptoEntryId, 'K-1');
  assert.equal(avoir.creditNoteReason, 'Erreur de quantité');
  assert.equal(avoir.items.length, 1);
});

test('les appels GET/DELETE portent leurs paramètres en query string', () => {
  const params = construireParamsGet('getElectronicInvoice', { komptoEntryId: 'K-9' });
  assert.equal(params.get('komptoEntryId'), 'K-9');
  assert.equal(construireParamsGet('getVerify', { komptoEntryId: null }).toString(), '');
});

/* ------------------------------------------------------ 6. validation locale */

test('la validation locale bloque ce que la DGI refuserait de toute façon', () => {
  assert.equal(validerFacturePourKompto({ etablissement: ETAB, facture: FACTURE }).ok, true);

  const cas = [
    [{ etablissement: { ...ETAB, lignes: undefined }, facture: { ...FACTURE, lignes: [] } }, 'aucune_ligne'],
    [{ etablissement: ETAB, facture: { ...FACTURE, client: { type: 'B2B', nom: 'X' } } }, 'b2b_ncc_client_manquant'],
    [
      { etablissement: ETAB, facture: { ...FACTURE, client: { type: 'B2B', nom: 'X', ncc: '12' } } },
      'b2b_ncc_client_malforme',
    ],
    [{ etablissement: { ...ETAB, fne_ncc: null }, facture: FACTURE }, 'etablissement_ncc_manquant'],
    [{ etablissement: { ...ETAB, fne_ncc: '82000011' }, facture: FACTURE }, 'etablissement_ncc_malforme'],
    [{ etablissement: { ...ETAB, fne_statut: 'en_cours' }, facture: FACTURE }, 'droit_fne:parcours_en_cours'],
    [{ etablissement: { ...ETAB, fne_choix: 'sans_fne' }, facture: FACTURE }, 'choix_sans_kompto'],
  ];
  for (const [args, attendu] of cas) {
    const r = validerFacturePourKompto(args);
    assert.equal(r.ok, false, attendu);
    assert.ok(r.erreurs.some((e) => e.startsWith(attendu)), `${attendu} → ${r.erreurs.join(',')}`);
  }
});

test('cas d’erreur obligatoire : une TVA non reconnue est rejetée avant l’appel', () => {
  const r = validerFacturePourKompto({
    etablissement: ETAB,
    facture: {
      ...FACTURE,
      lignes: [{ designation: 'A', quantite: 1, prixUnitaire: 100, codeTva: 'TVAZ' }],
    },
  });
  assert.equal(r.ok, false);
  assert.ok(r.erreurs.includes('ligne_0:tva_non_reconnue:TVAZ'));
});

test('une ligne invalide est rejetée sans consommer d’appel API', () => {
  const r = validerFacturePourKompto({
    etablissement: ETAB,
    facture: {
      ...FACTURE,
      lignes: [
        { designation: '', quantite: 0, prixUnitaire: -5, codeTva: 'TVA' },
      ],
    },
  });
  assert.equal(r.ok, false);
  assert.ok(r.erreurs.includes('ligne_0:designation_vide'));
  assert.ok(r.erreurs.includes('ligne_0:quantite_invalide'));
  assert.ok(r.erreurs.includes('ligne_0:prix_invalide'));
});

/* --------------------------------- 7. transport : la clé ne sort jamais du serveur */

/** Simule la fonction Edge Supabase (pas KOMPTO) et mémorise les appels. */
function mockEdge(reponses) {
  const appels = [];
  const fetchImpl = async (url, options) => {
    appels.push({ url, options, corps: JSON.parse(options.body) });
    const r = reponses[appels.length - 1] ?? reponses[reponses.length - 1];
    return {
      ok: r.statut >= 200 && r.statut < 300,
      status: r.statut,
      json: async () => r.corps,
    };
  };
  return { appels, fetchImpl };
}

const URL_FONCTION = 'https://xyz.supabase.co/functions/v1/fne-kompto';

test('SECURITE : le navigateur appelle la fonction Edge, jamais kompto.com', async () => {
  const { appels, fetchImpl } = mockEdge([
    { statut: 200, corps: { ok: true, statut: 200, corps: { komptoEntryId: 'K-1', totalTTC: 118000 } } },
  ]);
  const client = creerClientKompto({
    urlFonction: URL_FONCTION,
    obtenirJeton: async () => 'jwt-utilisateur',
    cleAnon: 'cle-anon-publique',
    fetchImpl,
  });

  const r = await client.verify({ etablissement: ETAB, facture: FACTURE });
  assert.equal(r.ok, true);
  assert.equal(r.komptoEntryId, 'K-1');

  assert.equal(appels.length, 1);
  assert.equal(appels[0].url, URL_FONCTION);
  assert.match(URL_FONCTION, /functions\/v1\/fne-kompto$/);
  // Aucun appel direct à KOMPTO depuis le navigateur.
  for (const a of appels) assert.equal(/kompto\.com/.test(a.url), false, a.url);
  // L'en-tête Authorization porte le JWT de l'UTILISATEUR, jamais la clé KOMPTO.
  assert.equal(appels[0].options.headers.Authorization, 'Bearer jwt-utilisateur');
  assert.equal(appels[0].options.headers.apikey, 'cle-anon-publique');
  assert.equal(/kompto_key|KOMPTO_API_KEY/i.test(JSON.stringify(appels[0].options.headers)), false);
});

test('cycle complet verify → confirm → récupération sur KOMPTO simulé', async () => {
  const { appels, fetchImpl } = mockEdge([
    { statut: 200, corps: { ok: true, statut: 200, corps: { komptoEntryId: 'K-42', totalHT: 100000, totalTVA: 18000, totalTTC: 118000 } } },
    { statut: 200, corps: { ok: true, statut: 200, corps: { komptoEntryId: 'K-42', invoiceNumber: 'CI2026-8200001A-000042', certificate: { sticker: 'S' }, qrCode: 'QR' } } },
    { statut: 200, corps: { ok: true, statut: 200, corps: { komptoEntryId: 'K-42', invoiceNumber: 'CI2026-8200001A-000042', pdfUrl: 'https://app.kompto.com/f/42.pdf' } } },
  ]);
  const client = creerClientKompto({
    urlFonction: URL_FONCTION,
    obtenirJeton: async () => 'jwt',
    fetchImpl,
  });

  // Étape 1 — /verify : calcul et vérification avant envoi, aucun engagement.
  const verif = await client.verify({ etablissement: ETAB, facture: FACTURE });
  assert.equal(verif.ok, true);
  const entryId = verif.komptoEntryId;
  assert.equal(entryId, 'K-42');          // à stocker IMMÉDIATEMENT
  assert.equal(appels[0].corps.action, 'verify');
  assert.equal(appels[0].corps.etablissementId, 'e1');

  // Étape 2 — /confirm : soumission officielle, irréversible.
  const conf = await client.confirm({ komptoEntryId: entryId, etablissementId: 'e1' });
  assert.equal(conf.ok, true);
  assert.equal(conf.numeroFiscal, 'CI2026-8200001A-000042');
  assert.equal(appels[1].corps.action, 'confirm');
  assert.deepEqual(appels[1].corps.corps, { komptoEntryId: 'K-42' });

  // Étape 3 — /getElectronicInvoice : récupération et affichage.
  const recup = await client.getElectronicInvoice({ komptoEntryId: entryId, etablissementId: 'e1' });
  assert.equal(recup.ok, true);
  assert.equal(appels[2].corps.action, 'getElectronicInvoice');
  assert.ok(recup.certificat);
});

test('/delete n’est possible qu’avant confirmation, /createCreditNote après', async () => {
  const { appels, fetchImpl } = mockEdge([
    { statut: 200, corps: { ok: true, statut: 200, corps: { komptoEntryId: 'K-7' } } },
    { statut: 200, corps: { ok: true, statut: 200, corps: { komptoEntryId: 'CN-1' } } },
  ]);
  const client = creerClientKompto({ urlFonction: URL_FONCTION, obtenirJeton: async () => 'jwt', fetchImpl });

  const del = await client.delete({ komptoEntryId: 'K-7', etablissementId: 'e1' });
  assert.equal(del.ok, true);
  assert.equal(appels[0].corps.action, 'delete');

  const avoir = await client.createCreditNote({
    komptoEntryId: 'K-7',
    motif: 'Retour marchandise',
    lignes: [{ designation: 'Article A', quantite: 1, prixUnitaire: 1500, codeTva: 'TVA' }],
    etablissementId: 'e1',
  });
  assert.equal(avoir.ok, true);
  assert.equal(appels[1].corps.action, 'createCreditNote');
  assert.equal(appels[1].corps.corps.originalKomptoEntryId, 'K-7');
});

test('un refus KOMPTO (NCC invalide) est remonté sans planter l’écran', async () => {
  const { fetchImpl } = mockEdge([
    { statut: 400, corps: { ok: false, statut: 400, erreur: 'Le NCC du client est invalide', corps: { code: 'E_NCC', message: 'Le NCC du client est invalide' } } },
  ]);
  const client = creerClientKompto({ urlFonction: URL_FONCTION, obtenirJeton: async () => 'jwt', fetchImpl });
  const r = await client.verify({ etablissement: ETAB, facture: FACTURE });
  assert.equal(r.ok, false);
  assert.equal(r.statut, 400);
  assert.equal(classifierErreur(r.erreur), 'ncc_invalide');
});

test('une facture non conforme n’atteint même pas la fonction Edge', async () => {
  const { appels, fetchImpl } = mockEdge([{ statut: 200, corps: { ok: true, statut: 200, corps: {} } }]);
  const client = creerClientKompto({ urlFonction: URL_FONCTION, obtenirJeton: async () => 'jwt', fetchImpl });
  const r = await client.verify({
    etablissement: { ...ETAB, fne_statut: 'aucune' },
    facture: FACTURE,
  });
  assert.equal(r.ok, false);
  assert.ok(r.erreursLocales.length > 0);
  assert.equal(appels.length, 0);          // aucun appel réseau consommé
});

test('une panne réseau est signalée proprement', async () => {
  const client = creerClientKompto({
    urlFonction: URL_FONCTION,
    obtenirJeton: async () => 'jwt',
    fetchImpl: async () => { throw new Error('timeout'); },
  });
  const r = await client.confirm({ komptoEntryId: 'K-1', etablissementId: 'e1' });
  assert.equal(r.ok, false);
  assert.equal(r.motif, 'reseau');
  assert.match(r.erreur, /timeout/);
});

test('un client sans fonction Edge configurée explique pourquoi il échoue', async () => {
  const client = creerClientKompto({ urlFonction: '', obtenirJeton: async () => 'jwt' });
  const r = await client.confirm({ komptoEntryId: 'K-1', etablissementId: 'e1' });
  assert.equal(r.ok, false);
  assert.match(r.erreur, /fonction Edge fne-kompto/);
  assert.equal(NOM_FONCTION_EDGE, 'fne-kompto');
});

test('une action inconnue est refusée', async () => {
  const client = creerClientKompto({ urlFonction: URL_FONCTION, obtenirJeton: async () => 'jwt' });
  const r = await client.appeler('detruireTout', {});
  assert.equal(r.ok, false);
  assert.match(r.erreur, /Action KOMPTO inconnue/);
});

/* ------------------------------------------------ 8. garde-fous de mise en prod */

test('la production est bloquée tant que des points du contrat sont TBD', () => {
  const avant = configurationPretPourProduction();
  assert.equal(avant.pret, false);
  assert.ok(avant.bloquants.length >= 9);
  assert.ok(avant.bloquants.some((b) => b.includes('TBD-KOMPTO#1')));
  assert.ok(avant.bloquants.some((b) => b.includes('12 scénarios')));

  // Même avec les scénarios validés, les TBD du guide bloquent encore.
  assert.equal(configurationPretPourProduction({ scenariValides: true }).pret, false);
});

test('le diagnostic affiche l’environnement et la valeur fiscale des factures', () => {
  const d = diagnosticKompto({ etablissement: ETAB });
  assert.equal(d.environnement, 'sandbox');
  assert.equal(d.baseUrl, 'https://qa.kompto.com');
  // Une facture de test n'a AUCUNE valeur fiscale : l'UI doit le dire.
  assert.equal(d.valeurFiscale, false);
  assert.equal(d.endpoints, 7);
  assert.equal(d.identifiantsComplets, true);
  assert.equal(d.nccCanonique, '8200001A');
  assert.equal(d.pretPourProduction, false);
});
