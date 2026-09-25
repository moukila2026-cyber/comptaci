/**
 * kompto.js — Adaptateur API KOMPTO (intégrateur FNE agréé DGI Côte d'Ivoire)
 * ============================================================================
 * Ce module est le SEUL endroit du projet qui connaît le contrat HTTP de
 * KOMPTO. Tout le reste de ComptaCi (écran de facturation, edge function,
 * base de données) parle à ces fonctions, jamais à KOMPTO directement.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  SÉCURITÉ — LA CLÉ API NE VA JAMAIS DANS LE NAVIGATEUR
 * ────────────────────────────────────────────────────────────────────────────
 * La clé API KOMPTO est une clé d'INTÉGRATEUR, partagée par tous les marchands
 * ComptaCi. Or ce projet est une SPA Vite : toute variable `VITE_*` est
 * compilée dans le bundle JS public et lisible par n'importe qui. Une clé
 * exposée permettrait d'émettre des factures certifiées frauduleuses au nom de
 * ComptaCi et d'épuiser le quota DGI.
 *
 * Ce module n'appelle donc JAMAIS `*.kompto.com`. Il appelle la fonction Edge
 * Supabase `fne-kompto`, qui détient la clé en secret serveur (`KOMPTO_API_KEY`)
 * et relaie l'appel. C'est exactement le modèle déjà en place pour
 * `webhook-saspay` (secret `SASPAY_WEBHOOK_SECRET`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  CE QUI EST CONFIRMÉ vs À CONFIRMER
 * ────────────────────────────────────────────────────────────────────────────
 * CONFIRMÉ par la page publique officielle https://kompto.com/KomptoApi :
 *   • URL de base production : https://app.kompto.com
 *   • Authentification : `Authorization: Bearer {clé_api}`
 *   • Les 7 endpoints `/api/invoice/*` et leurs verbes HTTP
 *   • Le payload de `/verify` (exemple curl fonctionnel publié) :
 *     clientType, clientName, clientNCC, clientTelephone, clientEmail,
 *     paymentMethod, items[{itemName, itemQuantity, itemUnitPrice, itemTVAName}]
 *   • Les 4 types de client : B2B (NCC obligatoire), B2C, B2G, B2F
 *   • Les 5 codes TVA : TVA 18 %, TVAB 9 %, TVAC, TVAD, TVAE 0 %
 *   • `paymentMethod: "transfer"` (seule valeur littérale publiée)
 *   • Le passage sandbox → production ne change que 3 choses : l'URL de base,
 *     la clé API, et les identifiants établissement / point de vente
 *
 * À CONFIRMER par le « Guide API KOMPTO FR v.5.3 » (93 p.) + la collection
 * Postman — ces documents ne sont PAS publics et n'ont pas pu être lus dans
 * cet environnement. Chaque point est isolé ci-dessous derrière un marqueur
 * `TBD-KOMPTO` unique, pour qu'une relecture du guide se traduise par
 * quelques lignes modifiées à un seul endroit :
 *   1. emplacement exact de `establishment` / `pointOfSale` dans la requête
 *   2. corps exact de `/confirm`
 *   3. emplacement de `komptoEntryId` dans la réponse de `/verify`
 *   4. noms des paramètres GET de `/getVerify` et `/getElectronicInvoice`
 *   5. corps exact de `/createCreditNote`
 *   6. valeurs littérales de `paymentMethod` autres que "transfer"
 *   7. index des erreurs (codes renvoyés pour NCC invalide / TVA non reconnue)
 *   8. champs B2F (devise, taux de change)
 *   9. endpoints du parcours d'enrôlement « Créer une FNE » (création du compte
 *      FNE, de l'établissement et du point de vente par KOMPTO) — ils ne font
 *      PAS partie des 7 endpoints de facturation publiés
 *
 * ⚠️ Une autre équipe a publié un scaffold KOMPTO en devinant ces champs, puis
 * l'a fermé en écrivant que « les noms de champs KOMPTO, le découpage
 * verify/confirm et le corps de confirm deviné sont le mauvais contrat »
 * (github.com/lomiafrica/lomi./pull/108). Ne jamais activer la production sur
 * des champs marqués TBD-KOMPTO : les valider d'abord en sandbox.
 */

import {
  choixViaKompto,
  droitFne,
  identifiantsKomptoComplets,
  nccCanonique,
  nccValideForme,
  normaliserChoix,
  normaliserIdentifiant,
} from "./fneOption.js";

/* -------------------------------------------------------------------------- */
/* 1. Environnements                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Environnements KOMPTO. Le développement démarre en SANDBOX (qa.kompto.com),
 * qui expose exactement les mêmes appels que la production et produit des
 * factures de test sans valeur fiscale. La production est app.kompto.com.
 */
export const KOMPTO_ENVIRONNEMENTS = {
  sandbox: {
    id: "sandbox",
    baseUrl: "https://qa.kompto.com",
    /** Les factures de test n'ont aucune valeur fiscale. */
    valeurFiscale: false,
  },
  production: {
    id: "production",
    baseUrl: "https://app.kompto.com",
    valeurFiscale: true,
  },
};

/**
 * Environnement par défaut : SANDBOX.
 * On ne bascule en production qu'après validation explicite (variable
 * d'environnement + les 12 scénarios de test passés en sandbox).
 */
export const ENVIRONNEMENT_PAR_DEFAUT = "sandbox";

/** Environnement courant, surchargeable par `VITE_KOMPTO_ENVIRONNEMENT`. */
export function environnementKompto(valeur) {
  const demande = String(
    valeur ??
      (typeof import.meta !== "undefined" && import.meta.env
        ? import.meta.env.VITE_KOMPTO_ENVIRONNEMENT
        : "") ??
      ""
  )
    .trim()
    .toLowerCase();
  return KOMPTO_ENVIRONNEMENTS[demande] ? demande : ENVIRONNEMENT_PAR_DEFAUT;
}

/** URL de base KOMPTO pour un environnement donné. */
export function baseUrlKompto(env = ENVIRONNEMENT_PAR_DEFAUT) {
  return (KOMPTO_ENVIRONNEMENTS[env] || KOMPTO_ENVIRONNEMENTS.sandbox).baseUrl;
}

/* -------------------------------------------------------------------------- */
/* 2. Endpoints (CONFIRMÉ — page publique officielle)                          */
/* -------------------------------------------------------------------------- */

/**
 * Chemins des 7 appels du cycle de vie d'une facture normalisée.
 * L'ordre ci-dessous est celui du parcours recommandé par KOMPTO.
 */
export const KOMPTO_ENDPOINTS = {
  /** POST — valider les données et calculer tous les montants, sans soumission DGI. */
  verify: { methode: "POST", chemin: "/api/invoice/verify" },
  /** GET — relire une facture vérifiée non encore soumise. */
  getVerify: { methode: "GET", chemin: "/api/invoice/getVerify" },
  /** POST — confirmer et soumettre la facture à la DGI. IRRÉVERSIBLE. */
  confirm: { methode: "POST", chemin: "/api/invoice/confirm" },
  /** GET — récupérer la FNE confirmée, son numéro fiscal et son certificat. */
  getElectronicInvoice: { methode: "GET", chemin: "/api/invoice/getElectronicInvoice" },
  /** DELETE — supprimer une facture en attente, AVANT confirmation. */
  delete: { methode: "DELETE", chemin: "/api/invoice/delete" },
  /** POST — vérifier ET confirmer en un seul appel (intégration éprouvée). */
  create: { methode: "POST", chemin: "/api/invoice/create" },
  /** POST — émettre un avoir sur une facture déjà confirmée. */
  createCreditNote: { methode: "POST", chemin: "/api/invoice/createCreditNote" },
};

/** URL absolue d'un endpoint pour un environnement donné. */
export function urlEndpoint(action, env = ENVIRONNEMENT_PAR_DEFAUT) {
  const e = KOMPTO_ENDPOINTS[action];
  if (!e) throw new Error(`Action KOMPTO inconnue : ${action}`);
  return `${baseUrlKompto(env)}${e.chemin}`;
}

/* -------------------------------------------------------------------------- */
/* 3. Référentiels DGI (CONFIRMÉ — page publique officielle)                   */
/* -------------------------------------------------------------------------- */

/**
 * Les 4 types de client.
 * B2B exige le NCC du client ; B2F exige devise et taux de change.
 */
export const TYPES_CLIENT = {
  B2B: { code: "B2B", libelle: "Entreprise ivoirienne", nccObligatoire: true, deviseObligatoire: false },
  B2C: { code: "B2C", libelle: "Particulier", nccObligatoire: false, deviseObligatoire: false },
  B2G: { code: "B2G", libelle: "Administration publique", nccObligatoire: false, deviseObligatoire: false },
  B2F: { code: "B2F", libelle: "Client étranger", nccObligatoire: false, deviseObligatoire: true },
};

/**
 * Les 5 codes de TVA.
 * TVA  = 18 % (taux normal)
 * TVAB =  9 % (taux réduit)
 * TVAC =  0 % (exonération par convention)
 * TVAD =  0 % (exonération légale)
 * TVAE =  0 % (export)
 *
 * Le taux n'est PAS envoyé à KOMPTO : on n'envoie que le code, KOMPTO et la
 * DGI calculent les montants. Envoyer un taux calculé soi-même est interdit
 * par le contrat (« Vous n'envoyez jamais de montants calculés »).
 */
export const CODES_TVA = {
  TVA: { code: "TVA", taux: 18, libelle: "TVA normale 18 %" },
  TVAB: { code: "TVAB", taux: 9, libelle: "TVA réduite 9 %" },
  TVAC: { code: "TVAC", taux: 0, libelle: "Exonération par convention 0 %" },
  TVAD: { code: "TVAD", taux: 0, libelle: "Exonération légale 0 %" },
  TVAE: { code: "TVAE", taux: 0, libelle: "Export 0 %" },
};

/** Code TVA par défaut quand l'article n'en précise pas (taux normal ivoirien). */
export const CODE_TVA_PAR_DEFAUT = "TVA";

/** Un code TVA est-il reconnu par la DGI ? */
export function codeTvaValide(code) {
  return Boolean(CODES_TVA[String(code ?? "").trim().toUpperCase()]);
}

/**
 * Modes de paiement acceptés par KOMPTO.
 *
 * Seul `"transfer"` est une valeur littérale CONFIRMÉE (exemple curl publié).
 * Les autres correspondent aux modes décrits en toutes lettres par KOMPTO
 * (espèces, carte, chèque, mobile money Wave / Orange Money / MTN Money,
 * paiement différé) mais leur VALEUR LITTÉRALE EXACTE reste à confirmer.
 *
 * TBD-KOMPTO #6 : remplacer les valeurs `kompto` ci-dessous par celles du
 * guide v.5.3, puis passer `confirme: true`. Tant qu'un mode n'est pas
 * confirmé, `modePaiementKompto()` retombe sur `transfer` plutôt que
 * d'envoyer une valeur inventée qui ferait rejeter la facture.
 */
export const MODES_PAIEMENT = {
  virement: { kompto: "transfer", confirme: true, libelle: "Virement" },
  espece: { kompto: "transfer", confirme: false, libelle: "Espèces" },
  carte: { kompto: "transfer", confirme: false, libelle: "Carte bancaire" },
  cheque: { kompto: "transfer", confirme: false, libelle: "Chèque" },
  wave: { kompto: "transfer", confirme: false, libelle: "Wave" },
  orange_money: { kompto: "transfer", confirme: false, libelle: "Orange Money" },
  mtn_money: { kompto: "transfer", confirme: false, libelle: "MTN Money" },
  differe: { kompto: "transfer", confirme: false, libelle: "Paiement différé" },
};

/** Valeur `paymentMethod` à envoyer ; retombe sur "transfer" si non confirmé. */
export function modePaiementKompto(modeComptaCi) {
  const cle = String(modeComptaCi ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const trouve = MODES_PAIEMENT[cle];
  // On n'envoie JAMAIS une valeur non confirmée à la DGI.
  return trouve?.confirme ? trouve.kompto : MODES_PAIEMENT.virement.kompto;
}

/* -------------------------------------------------------------------------- */
/* 4. Identifiants établissement — TBD-KOMPTO #1                               */
/* -------------------------------------------------------------------------- */

/**
 * TBD-KOMPTO #1 — Emplacement de `establishment` et `pointOfSale`.
 *
 * L'exemple curl PUBLIC de `/verify` ne contient ni `establishment` ni
 * `pointOfSale`. Le guide v.5.3 précise où ils doivent être placés (corps de
 * la requête, en-tête dédié, ou paramètre GET).
 *
 * Hypothèse retenue en attendant : corps de la requête, en camelCase, ce qui
 * suit (a) la convention camelCase confirmée du payload (`clientType`,
 * `clientName`, `clientNCC`, `paymentMethod`, `itemName`…) et (b) les noms
 * exacts donnés par le cahier des charges ComptaCi (« establishment,
 * pointOfSale, NCC »).
 *
 * Pour valider/corriger après lecture du guide, il suffit de modifier les deux
 * constantes ci-dessous — RIEN d'autre dans le projet n'en dépend.
 */
export const NOM_CHAMP_ETABLISHMENT = "establishment";
export const NOM_CHAMP_POINT_OF_SALE = "pointOfSale";

/**
 * Vrai si l'emplacement des identifiants établissement est CONFIRMÉ par le
 * guide. Passer à `true` une fois la valeur exacte vérifiée en sandbox.
 * Tant que c'est `false`, `configurationPretPourProduction()` refuse la prod.
 */
export const IDENTIFIANTS_EMPLACEMENT_CONFIRME = false;

/**
 * Construit le fragment d'identifiants à fusionner dans une requête KOMPTO.
 * Retourne `{}` si l'établissement n'a pas ses trois identifiants : on préfère
 * une erreur locale explicite à un appel API voué à échouer.
 */
export function champsEtablissementKompto(etablissement) {
  if (!identifiantsKomptoComplets(etablissement)) return {};
  return {
    [NOM_CHAMP_ETABLISHMENT]: normaliserIdentifiant(etablissement.fne_establishment),
    [NOM_CHAMP_POINT_OF_SALE]: normaliserIdentifiant(etablissement.fne_point_of_sale),
  };
}

/* -------------------------------------------------------------------------- */
/* 5. Construction des payloads                                                */
/* -------------------------------------------------------------------------- */

/** Arrondi monétaire FCFA : les montants DGI sont en francs entiers. */
function entier(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * Construit une ligne d'article au format KOMPTO (CONFIRMÉ).
 *
 * On n'envoie AUCUN montant calculé : ni HT, ni TVA, ni TTC, ni total.
 * KOMPTO calcule tout et la DGI recalcule — c'est le cœur du contrat
 * (« Vous n'envoyez jamais de montants calculés »).
 */
export function construireItemKompto(ligne) {
  const codeTva = String(ligne?.codeTva ?? ligne?.itemTVAName ?? CODE_TVA_PAR_DEFAUT)
    .trim()
    .toUpperCase();
  return {
    itemName: String(ligne?.designation ?? ligne?.itemName ?? "").trim(),
    itemQuantity: Number(ligne?.quantite ?? ligne?.itemQuantity ?? 0),
    itemUnitPrice: entier(ligne?.prixUnitaire ?? ligne?.itemUnitPrice ?? 0),
    itemTVAName: codeTva,
    // Remise : le guide public mentionne les remises parmi les données
    // envoyées. TBD-KOMPTO : nom exact du champ de remise à confirmer.
    ...(Number(ligne?.remise) > 0 ? { itemDiscount: Number(ligne.remise) } : {}),
  };
}

/**
 * Construit le payload de `/verify` (structure CONFIRMÉE par l'exemple curl
 * officiel), complété par les identifiants établissement (TBD-KOMPTO #1).
 *
 * @param {Object} p
 * @param {Object} p.etablissement  ligne `etablissements` (fne_establishment, fne_point_of_sale, fne_ncc)
 * @param {Object} p.facture        { lignes:[{designation,quantite,prixUnitaire,codeTva,remise}], client:{...}, modePaiement }
 */
export function construirePayloadVerify({ etablissement, facture }) {
  const client = facture?.client || {};
  const typeClient = String(client.type ?? "B2C").trim().toUpperCase();

  const payload = {
    ...champsEtablissementKompto(etablissement),
    clientType: TYPES_CLIENT[typeClient] ? typeClient : "B2C",
    clientName: String(client.nom ?? "").trim(),
    paymentMethod: modePaiementKompto(facture?.modePaiement ?? client.modePaiement),
    items: (facture?.lignes || []).map(construireItemKompto),
  };

  // NCC du client : obligatoire en B2B, inutile sinon.
  const nccClient = normaliserIdentifiant(client.ncc ?? client.clientNCC);
  if (nccClient) payload.clientNCC = nccClient;

  // Coordonnées facultatives (présentes dans l'exemple curl officiel).
  const tel = normaliserIdentifiant(client.telephone);
  if (tel) payload.clientTelephone = tel;
  const email = normaliserIdentifiant(client.email);
  if (email) payload.clientEmail = email;

  // TBD-KOMPTO #8 — B2F : devise et taux de change obligatoires pour un client
  // étranger. Les noms de champs exacts restent à confirmer par le guide.
  if (payload.clientType === "B2F") {
    const devise = normaliserIdentifiant(client.devise);
    if (devise) payload.currency = devise.toUpperCase();
    if (Number(client.tauxChange) > 0) payload.exchangeRate = Number(client.tauxChange);
  }

  return payload;
}

/**
 * Construit le payload de `/confirm`.
 *
 * TBD-KOMPTO #2 — Le corps exact de `/confirm` n'est pas publié. Deux formes
 * sont plausibles : (a) renvoi du seul identifiant obtenu au `/verify`,
 * (b) renvoi du payload complet recalculé. La forme (a) est implémentée ici
 * car c'est le sens du découpage verify→confirm décrit par KOMPTO
 * (« /verify vous renvoie les montants, /confirm génère la FNE »).
 * À valider impérativement en sandbox avant production.
 */
export function construirePayloadConfirm({ komptoEntryId, payloadVerifie }) {
  const id = normaliserIdentifiant(komptoEntryId);
  if (id) return { komptoEntryId: id };
  return { ...(payloadVerifie || {}) };
}

/**
 * Construit le payload de `/createCreditNote` (avoir).
 *
 * Un avoir corrige une facture DÉJÀ CONFIRMÉE : une FNE confirmée est un
 * document légal irréversible, la seule correction possible est un avoir, qui
 * est lui-même une facture déclarée à la DGI.
 *
 * TBD-KOMPTO #5 — corps exact à confirmer. On fournit l'identifiant de la
 * facture d'origine (obtenu au `/verify`, d'où l'obligation de le stocker)
 * et les lignes d'annulation.
 */
export function construirePayloadAvoir({ komptoEntryId, motif, lignes }) {
  return {
    // TBD-KOMPTO #5 : nom exact du champ référençant la facture d'origine.
    originalKomptoEntryId: normaliserIdentifiant(komptoEntryId),
    ...(normaliserIdentifiant(motif) ? { creditNoteReason: String(motif).trim() } : {}),
    items: (lignes || []).map(construireItemKompto),
  };
}

/**
 * Paramètres de requête GET.
 *
 * TBD-KOMPTO #4 — noms exacts des paramètres de `/getVerify` et
 * `/getElectronicInvoice` à confirmer. `komptoEntryId` est le candidat
 * cohérent avec le nom imposé par le cahier des charges.
 */
export function construireParamsGet(action, { komptoEntryId }) {
  const params = new URLSearchParams();
  const id = normaliserIdentifiant(komptoEntryId);
  if (id) params.set("komptoEntryId", id);
  if (action === "delete") return params;
  return params;
}

/* -------------------------------------------------------------------------- */
/* 6. Lecture des réponses — TBD-KOMPTO #3                                     */
/* -------------------------------------------------------------------------- */

/** Chemins candidats, dans l'ordre de priorité. */
const CHEMINS_KOMPTO_ENTRY_ID = [
  "komptoEntryId",
  "KomptoEntryId",
  "entryId",
  "data.komptoEntryId",
  "data.entryId",
  "result.komptoEntryId",
  "result.entryId",
  "invoice.komptoEntryId",
  "invoiceId",
  "id",
];

/** Lit une valeur imbriquée par chemin pointé ("data.komptoEntryId"). */
function lireChemin(objet, chemin) {
  return String(chemin)
    .split(".")
    .reduce((acc, cle) => (acc == null ? acc : acc[cle]), objet);
}

/**
 * Extrait le `komptoEntryId` d'une réponse KOMPTO.
 *
 * ⚠️ À stocker IMPÉRATIVEMENT dès le `/verify` : c'est la seule référence qui
 * permettra ensuite `/confirm`, `/getVerify`, `/getElectronicInvoice`,
 * `/delete` et surtout `/createCreditNote` (un avoir sur facture confirmée est
 * impossible sans elle).
 *
 * TBD-KOMPTO #3 : réduire `CHEMINS_KOMPTO_ENTRY_ID` au chemin réel dès lecture
 * du guide. Le parcours multi-chemins est un filet de sécurité, pas un contrat.
 *
 * @returns {string|null}
 */
export function lireKomptoEntryId(reponse) {
  if (reponse == null) return null;
  if (typeof reponse === "string") return normaliserIdentifiant(reponse);
  for (const chemin of CHEMINS_KOMPTO_ENTRY_ID) {
    const valeur = lireChemin(reponse, chemin);
    const id = normaliserIdentifiant(valeur);
    if (id) return id;
  }
  return null;
}

/** Extrait le numéro fiscal de la FNE confirmée. */
export function lireNumeroFiscal(reponse) {
  if (reponse == null) return null;
  for (const chemin of [
    "invoiceNumber",
    "numero",
    "data.invoiceNumber",
    "data.numero",
    "fneNumber",
    "taxInvoiceNumber",
  ]) {
    const v = normaliserIdentifiant(lireChemin(reponse, chemin));
    if (v) return v;
  }
  return null;
}

/** Extrait le certificat fiscal / sticker (visuel FNE + QR) renvoyé par `/confirm`. */
export function lireCertificat(reponse) {
  if (reponse == null) return null;
  const candidats = {};
  for (const [cle, chemins] of Object.entries({
    certificat: ["certificate", "fiscalCertificate", "data.certificate", "sticker"],
    qr: ["qrCode", "qr", "data.qrCode", "qrPayload"],
    visuelFne: ["fneVisual", "visual", "data.fneVisual"],
    pdf: ["pdfUrl", "invoiceUrl", "data.pdfUrl"],
  })) {
    for (const chemin of chemins) {
      const v = lireChemin(reponse, chemin);
      if (v != null && v !== "") {
        candidats[cle] = typeof v === "string" ? v : v;
        break;
      }
    }
  }
  return Object.keys(candidats).length > 0 ? candidats : null;
}

/**
 * Normalise une réponse KOMPTO en résultat exploitable par ComptaCi.
 * Ne lève jamais : un échec d'analyse est retourné comme erreur structurée.
 */
export function normaliserReponseKompto(reponseBrute, { ok = true, statut = 200 } = {}) {
  let corps = reponseBrute;
  if (typeof reponseBrute === "string") {
    try {
      corps = JSON.parse(reponseBrute);
    } catch (_) {
      corps = { brut: reponseBrute };
    }
  }
  const resultat = {
    ok: Boolean(ok && statut >= 200 && statut < 300),
    statut,
    brut: corps,
    komptoEntryId: lireKomptoEntryId(corps),
    numeroFiscal: lireNumeroFiscal(corps),
    certificat: lireCertificat(corps),
    erreur: null,
    codeErreur: null,
  };
  if (!resultat.ok) {
    resultat.erreur =
      normaliserIdentifiant(lireChemin(corps, "message")) ||
      normaliserIdentifiant(lireChemin(corps, "error")) ||
      normaliserIdentifiant(lireChemin(corps, "title")) ||
      `KOMPTO a refusé l'appel (HTTP ${statut}).`;
    resultat.codeErreur =
      normaliserIdentifiant(lireChemin(corps, "code")) ||
      normaliserIdentifiant(lireChemin(corps, "errorCode")) ||
      null;
  }
  return resultat;
}

/* -------------------------------------------------------------------------- */
/* 7. Validation locale avant appel                                            */
/* -------------------------------------------------------------------------- */

/**
 * TBD-KOMPTO #7 — Index des erreurs KOMPTO.
 * Les codes exacts renvoyés pour un NCC invalide ou une TVA non reconnue sont
 * dans le guide. En attendant, on associe les messages par MOTIF, ce qui suffit
 * à afficher une explication actionnable au commerçant.
 */
export const MOTIFS_ERREUR_CONNUS = [
  { motif: "ncc_invalide", test: /ncc|contribuable|taxpayer/i },
  { motif: "tva_inconnue", test: /tva|vat|tax ?code/i },
  { motif: "etablissement_inconnu", test: /establishment|établissement|point ?of ?sale/i },
  { motif: "authentification", test: /unauthor|forbidden|api ?key|bearer|cl[ée]/i },
  { motif: "deja_confirmee", test: /already confirm|d[ée]j[àa] confirm|irrevers/i },
];

/** Classe un message d'erreur KOMPTO en motif exploitable par l'UI. */
export function classifierErreur(message) {
  const texte = String(message ?? "");
  for (const { motif, test } of MOTIFS_ERREUR_CONNUS) {
    if (test.test(texte)) return motif;
  }
  return "inconnue";
}

/**
 * Contrôle la facture LOCALEMENT avant de consommer un appel API.
 *
 * Chaque contrôle correspond à un rejet certain côté KOMPTO/DGI ; les éviter
 * économise des appels et donne au commerçant une erreur claire plutôt qu'un
 * refus opaque de l'administration fiscale.
 *
 * @returns {{ok: boolean, erreurs: string[]}}
 */
export function validerFacturePourKompto({ etablissement, facture }) {
  const erreurs = [];

  if (!etablissement?.id) erreurs.push("etablissement_manquant");

  const droit = droitFne(etablissement);
  if (!droit.peutCertifier) erreurs.push(`droit_fne:${droit.raison}`);

  if (normaliserChoix(etablissement?.fne_choix) && !choixViaKompto(etablissement.fne_choix)) {
    erreurs.push("choix_sans_kompto");
  }

  const lignes = facture?.lignes || [];
  if (lignes.length === 0) erreurs.push("aucune_ligne");

  lignes.forEach((l, i) => {
    if (!String(l?.designation ?? "").trim()) erreurs.push(`ligne_${i}:designation_vide`);
    if (!(Number(l?.quantite) > 0)) erreurs.push(`ligne_${i}:quantite_invalide`);
    if (!(Number(l?.prixUnitaire) >= 0)) erreurs.push(`ligne_${i}:prix_invalide`);
    // TVA non reconnue : l'un des 2 cas d'erreur obligatoires avant production.
    const code = String(l?.codeTva ?? CODE_TVA_PAR_DEFAUT).trim().toUpperCase();
    if (!codeTvaValide(code)) erreurs.push(`ligne_${i}:tva_non_reconnue:${code}`);
  });

  const client = facture?.client || {};
  const typeClient = String(client.type ?? "B2C").trim().toUpperCase();
  if (!TYPES_CLIENT[typeClient]) erreurs.push(`type_client_inconnu:${typeClient}`);
  // NCC obligatoire en B2B — l'autre cas d'erreur obligatoire (NCC invalide).
  if (TYPES_CLIENT[typeClient]?.nccObligatoire) {
    const nccClient = normaliserIdentifiant(client.ncc);
    if (!nccClient) erreurs.push("b2b_ncc_client_manquant");
    else if (!nccValideForme(nccClient)) erreurs.push("b2b_ncc_client_malforme");
  }
  if (TYPES_CLIENT[typeClient]?.deviseObligatoire && !normaliserIdentifiant(client.devise)) {
    erreurs.push("b2f_devise_manquante");
  }
  if (!String(client.nom ?? "").trim()) erreurs.push("client_nom_vide");

  // NCC de l'ÉTABLISSEMENT émetteur : sans lui, aucune FNE n'est possible.
  if (!normaliserIdentifiant(etablissement?.fne_ncc)) erreurs.push("etablissement_ncc_manquant");
  else if (!nccValideForme(etablissement.fne_ncc)) erreurs.push("etablissement_ncc_malforme");

  return { ok: erreurs.length === 0, erreurs: [...new Set(erreurs)] };
}

/* -------------------------------------------------------------------------- */
/* 8. Transport — via la fonction Edge Supabase (jamais KOMPTO en direct)      */
/* -------------------------------------------------------------------------- */

/** Nom de la fonction Edge qui détient la clé API KOMPTO. */
export const NOM_FONCTION_EDGE = "fne-kompto";

/**
 * Crée un client KOMPTO.
 *
 * Le client n'appelle PAS `*.kompto.com` : il appelle la fonction Edge
 * Supabase `fne-kompto`, qui relaie vers KOMPTO avec la clé serveur. Le
 * navigateur ne voit donc jamais la clé API.
 *
 * `fetchImpl` est injectable pour permettre les tests unitaires du cycle
 * complet verify→confirm→avoir sur un KOMPTO simulé (c'est aussi la base du
 * harnais des 12 scénarios de validation sandbox).
 *
 * @param {Object} p
 * @param {string} p.urlFonction   URL de la fonction Edge (…/functions/v1/fne-kompto)
 * @param {Function} p.obtenirJeton  () => Promise<string> JWT de l'utilisateur Supabase
 * @param {Function} [p.cleAnon]     clé anon Supabase (en-tête `apikey`)
 * @param {Function} [p.fetchImpl]   fetch injecté (tests)
 */
export function creerClientKompto({ urlFonction, obtenirJeton, cleAnon, fetchImpl } = {}) {
  const fetcher =
    fetchImpl || (typeof fetch === "function" ? fetch : null);

  async function appeler(action, corps, { etablissementId } = {}) {
    if (!KOMPTO_ENDPOINTS[action]) {
      return { ok: false, erreur: `Action KOMPTO inconnue : ${action}`, action };
    }
    if (!urlFonction) {
      return {
        ok: false,
        erreur: "La fonction Edge fne-kompto n'est pas configurée (VITE_SUPABASE_URL).",
        action,
      };
    }
    if (!fetcher) {
      return { ok: false, erreur: "fetch indisponible dans cet environnement.", action };
    }

    const entetes = { "Content-Type": "application/json" };
    if (cleAnon) entetes.apikey = cleAnon;
    try {
      const jeton = await obtenirJeton?.();
      if (jeton) entetes.Authorization = `Bearer ${jeton}`;
    } catch (_) {
      // Sans JWT la fonction Edge refusera : on laisse passer pour obtenir
      // son message d'erreur explicite plutôt qu'un échec silencieux ici.
    }

    try {
      const reponse = await fetcher(urlFonction, {
        method: "POST",
        headers: entetes,
        body: JSON.stringify({ action, etablissementId: etablissementId ?? null, corps }),
      });
      let brut = null;
      try {
        brut = await reponse.json();
      } catch (_) {
        brut = null;
      }
      // La fonction Edge renvoie { ok, statut, corps } ; on renvoie le corps
      // KOMPTO normalisé pour que l'appelant n'ait qu'un seul format à gérer.
      const corpsKompto = brut && typeof brut === "object" && "corps" in brut ? brut.corps : brut;
      const statut = brut?.statut ?? reponse.status;
      const resultat = normaliserReponseKompto(corpsKompto, { ok: reponse.ok, statut });
      if (brut && typeof brut === "object" && brut.erreur && !resultat.erreur) {
        resultat.erreur = brut.erreur;
      }
      return { ...resultat, action };
    } catch (e) {
      return {
        ok: false,
        statut: 0,
        erreur: String(e?.message || e),
        motif: "reseau",
        action,
      };
    }
  }

  return {
    /** Étape 1 — calcul et vérification avant envoi. Aucun engagement fiscal. */
    verify: ({ etablissement, facture }) => {
      const validation = validerFacturePourKompto({ etablissement, facture });
      if (!validation.ok) {
        return Promise.resolve({
          ok: false,
          action: "verify",
          erreur: `Facture refusée par le contrôle local : ${validation.erreurs.join(", ")}`,
          erreursLocales: validation.erreurs,
        });
      }
      return appeler("verify", construirePayloadVerify({ etablissement, facture }), {
        etablissementId: etablissement.id,
      });
    },
    /** Étape 2 — soumission officielle à la DGI. IRRÉVERSIBLE. */
    confirm: ({ komptoEntryId, payloadVerifie, etablissementId }) =>
      appeler("confirm", construirePayloadConfirm({ komptoEntryId, payloadVerifie }), {
        etablissementId,
      }),
    /** Annulation d'une facture pas encore confirmée. */
    delete: ({ komptoEntryId, etablissementId }) =>
      appeler("delete", { komptoEntryId: normaliserIdentifiant(komptoEntryId) }, {
        etablissementId,
      }),
    /** Récupération de la FNE confirmée (numéro fiscal + certificat). */
    getElectronicInvoice: ({ komptoEntryId, etablissementId }) =>
      appeler(
        "getElectronicInvoice",
        Object.fromEntries(construireParamsGet("getElectronicInvoice", { komptoEntryId })),
        { etablissementId }
      ),
    /** Relecture d'une facture vérifiée non encore soumise. */
    getVerify: ({ komptoEntryId, etablissementId }) =>
      appeler(
        "getVerify",
        Object.fromEntries(construireParamsGet("getVerify", { komptoEntryId })),
        { etablissementId }
      ),
    /** Avoir sur une facture déjà confirmée (seule correction possible). */
    createCreditNote: ({ komptoEntryId, motif, lignes, etablissementId }) =>
      appeler("createCreditNote", construirePayloadAvoir({ komptoEntryId, motif, lignes }), {
        etablissementId,
      }),
    /** Vérifier + confirmer en un seul appel, une fois l'intégration éprouvée. */
    create: ({ etablissement, facture }) => {
      const validation = validerFacturePourKompto({ etablissement, facture });
      if (!validation.ok) {
        return Promise.resolve({
          ok: false,
          action: "create",
          erreur: `Facture refusée par le contrôle local : ${validation.erreurs.join(", ")}`,
          erreursLocales: validation.erreurs,
        });
      }
      return appeler("create", construirePayloadVerify({ etablissement, facture }), {
        etablissementId: etablissement.id,
      });
    },
    /** Accès bas niveau, pour les cas non couverts ci-dessus. */
    appeler,
  };
}

/* -------------------------------------------------------------------------- */
/* 9. Garde-fous de mise en production                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ce qui doit être VRAI avant de basculer un établissement en production.
 *
 * La production émet des documents fiscaux légaux et irréversibles. Ce garde-fou
 * refuse la bascule tant que (a) des points du contrat restent TBD, ou (b) les
 * scénarios de validation sandbox ne sont pas passés.
 *
 * @returns {{pret: boolean, bloquants: string[]}}
 */
export function configurationPretPourProduction({ scenariValides = false } = {}) {
  const bloquants = [];
  if (!IDENTIFIANTS_EMPLACEMENT_CONFIRME) {
    bloquants.push("TBD-KOMPTO#1 : emplacement de establishment/pointOfSale non confirmé par le guide v.5.3");
  }
  bloquants.push("TBD-KOMPTO#2 : corps de /confirm non confirmé par le guide v.5.3");
  bloquants.push("TBD-KOMPTO#3 : emplacement du komptoEntryId dans la réponse /verify non confirmé");
  bloquants.push("TBD-KOMPTO#4 : paramètres GET de /getVerify et /getElectronicInvoice non confirmés");
  bloquants.push("TBD-KOMPTO#5 : corps de /createCreditNote non confirmé");
  bloquants.push("TBD-KOMPTO#6 : valeurs paymentMethod autres que « transfer » non confirmées");
  bloquants.push("TBD-KOMPTO#7 : index des erreurs (NCC invalide, TVA non reconnue) non confirmé");
  bloquants.push("TBD-KOMPTO#8 : champs B2F (devise, taux de change) non confirmés");
  bloquants.push("TBD-KOMPTO#9 : endpoints du parcours d'enrôlement « Créer une FNE » non publiés");
  if (!scenariValides) {
    bloquants.push("Les 12 scénarios de validation sandbox ne sont pas tous passés");
  }
  return { pret: bloquants.length === 0, bloquants };
}

/**
 * Récapitulatif technique pour l'écran de configuration et le diagnostic.
 * Affiche l'environnement actif : un commerçant ne doit jamais croire qu'une
 * facture de test a une valeur fiscale.
 */
export function diagnosticKompto({ env = ENVIRONNEMENT_PAR_DEFAUT, etablissement } = {}) {
  const e = environnementKompto(env);
  return {
    environnement: e,
    baseUrl: baseUrlKompto(e),
    valeurFiscale: KOMPTO_ENVIRONNEMENTS[e].valeurFiscale,
    endpoints: Object.keys(KOMPTO_ENDPOINTS).length,
    identifiantsComplets: identifiantsKomptoComplets(etablissement),
    nccCanonique: etablissement?.fne_ncc ? nccCanonique(etablissement.fne_ncc) : null,
    pretPourProduction: configurationPretPourProduction().pret,
  };
}
