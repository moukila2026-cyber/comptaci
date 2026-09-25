/**
 * fneOption.js — Option FNE (Facture Normalisée Électronique) via KOMPTO
 * ---------------------------------------------------------------------------
 * Logique MÉTIER PURE : aucun import React ni Supabase, donc testable dans
 * Node (`node --test tests/fneOption.test.js`).
 *
 * ── Principe commercial (ne rien casser sur les plans existants) ──────────
 * Les tarifs des forfaits restent INCHANGÉS :
 *   Starter / Fondateur 7 000 FCFA/mois (verrouillé à vie pour les 100 premiers)
 *   Pro                 10 000 FCFA/mois
 *   Entreprise          20 000 FCFA/mois
 * (voir `PRIX_PLANS` dans PaiementSasPay.jsx — ce module n'y touche JAMAIS.)
 *
 * La FNE est une OPTION PAYANTE SÉPARÉE :
 *   100 000 FCFA / an / établissement, facturée d'avance annuellement.
 *   Coût réel KOMPTO : 80 000 FCFA/an → marge ComptaCi : 20 000 FCFA/an.
 *
 * Elle est disponible sur TOUS les plans, y compris Fondateur/Starter. C'est
 * un changement assumé par rapport à l'ancien écran `FacturationFNE.jsx` qui
 * la réservait aux plans Pro et Entreprise : l'accès n'est plus conditionné au
 * forfait mais au paiement de l'option (voir `droitFne`).
 *
 * ── Arbre de décision saisi à l'ajout / l'édition d'un établissement ───────
 * Q1 « Avez-vous déjà un compte FNE actif auprès de la DGI ? » → oui / non
 *
 *   non → Q2 : « creer »      Créer une FNE (parcours d'enregistrement KOMPTO)
 *              « sans_fne »   Ne pas créer de FNE (aucun coût, compta normale)
 *
 *   oui → Q2 : « connecter »  Connecter cette FNE à ComptaCi via KOMPTO
 *                             (saisie de establishment / pointOfSale / NCC)
 *              « methode_actuelle »
 *                             Garder sa méthode actuelle (plateforme/appli DGI
 *                             séparée) → compta interne seule, sans lien FNE
 *
 * Seuls « creer » et « connecter » déclenchent l'option payante.
 */

/* -------------------------------------------------------------------------- */
/* Tarifs                                                                      */
/* -------------------------------------------------------------------------- */

/** Prix public de l'option FNE, par établissement, par an (FCFA). */
export const PRIX_FNE_ANNUEL = 100000;

/** Coût réel facturé par KOMPTO à ComptaCi (FCFA/an/établissement). */
export const COUT_KOMPTO_ANNUEL = 80000;

/** Marge ComptaCi sur l'option FNE (FCFA/an/établissement). */
export const MARGE_FNE_ANNUELLE = PRIX_FNE_ANNUEL - COUT_KOMPTO_ANNUEL;

/** L'option est facturée d'avance, pour 12 mois. */
export const DUREE_OPTION_FNE_MOIS = 12;

/* -------------------------------------------------------------------------- */
/* Vocabulaire                                                                 */
/* -------------------------------------------------------------------------- */

/** Réponse à la question 1 : l'établissement a-t-il déjà un compte FNE DGI ? */
export const COMPTES_DGI = ["oui", "non"];

/**
 * Réponse à la question 2, c'est-à-dire le choix final de l'établissement.
 * Stocké dans `etablissements.fne_choix`.
 */
export const FNE_CHOIX = ["creer", "connecter", "sans_fne", "methode_actuelle"];

/**
 * Cycle de vie de l'option, stocké dans `etablissements.fne_statut` :
 *   aucune    → pas de FNE (choix « sans_fne » ou « methode_actuelle », ou rien)
 *   en_cours  → parcours lancé / paiement en attente / identifiants à valider
 *   active    → option payée ET intégration KOMPTO opérationnelle
 */
export const FNE_STATUTS = ["aucune", "en_cours", "active"];

/** Choix qui déclenchent l'option payante à 100 000 FCFA/an. */
export const CHOIX_PAYANTS = ["creer", "connecter"];

/** Choix qui passent par l'API KOMPTO (donc nécessitent l'option payante). */
export const CHOIX_VIA_KOMPTO = ["creer", "connecter"];

/* -------------------------------------------------------------------------- */
/* Arbre de décision                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Secondes options proposées selon la réponse à la question 1.
 * L'ordre du tableau est l'ordre d'affichage à l'écran.
 *
 * @param {"oui"|"non"} compteDgi
 * @returns {string[]} sous-ensemble de FNE_CHOIX
 */
export function choixSelonCompteDgi(compteDgi) {
  return compteDgi === "oui"
    ? ["connecter", "methode_actuelle"]
    : ["creer", "sans_fne"];
}

/** Un choix est-il cohérent avec la réponse à la question 1 ? */
export function choixCoherent(compteDgi, choix) {
  return choixSelonCompteDgi(compteDgi).includes(choix);
}

/** Ce choix fait-il payer l'option FNE (100 000 FCFA/an) ? */
export function choixPayant(choix) {
  return CHOIX_PAYANTS.includes(choix);
}

/** Ce choix passe-t-il par l'API KOMPTO ? */
export function choixViaKompto(choix) {
  return CHOIX_VIA_KOMPTO.includes(choix);
}

/**
 * Statut FNE induit par un choix, AVANT tout paiement.
 *
 * « creer » et « connecter » démarrent à `en_cours` : le parcours KOMPTO est
 * lancé mais l'option n'est ni payée ni opérationnelle. Les deux autres choix
 * restent à `aucune` — l'établissement est géré normalement dans ComptaCi,
 * sans facturation certifiée et sans aucun coût.
 *
 * @returns {"aucune"|"en_cours"}
 */
export function statutPourChoix(choix) {
  return choixPayant(choix) ? "en_cours" : "aucune";
}

/**
 * Identifiants KOMPTO exigés pour chaque choix.
 *
 * « connecter » : le commerçant possède déjà son compte FNE, il SAISIT ses
 *   identifiants existants → les trois champs sont obligatoires.
 * « creer » : KOMPTO crée le compte FNE, l'établissement et le point de vente ;
 *   les identifiants sont donc RÉCUPÉRÉS en fin de parcours, pas demandés
 *   d'avance. Aucun champ requis à la saisie.
 * « sans_fne » / « methode_actuelle » : aucun identifiant, aucun lien FNE.
 *
 * @returns {string[]} sous-ensemble de ["establishment","pointOfSale","ncc"]
 */
export function champsRequis(choix) {
  if (choix === "connecter") return ["establishment", "pointOfSale", "ncc"];
  return [];
}

/* -------------------------------------------------------------------------- */
/* Normalisation des saisies                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Normalise une réponse à la question 1. Toute valeur inattendue devient
 * `null` (question non encore posée) plutôt que « non » par défaut : on ne
 * veut pas faire dire au commerçant qu'il n'a pas de compte FNE.
 */
export function normaliserCompteDgi(valeur) {
  const v = String(valeur ?? "")
    .trim()
    .toLowerCase();
  if (["oui", "yes", "true", "1", "o"].includes(v)) return "oui";
  if (["non", "no", "false", "0", "n"].includes(v)) return "non";
  return null;
}

/** Normalise un choix FNE ; `null` si inconnu. */
export function normaliserChoix(valeur) {
  const v = String(valeur ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return FNE_CHOIX.includes(v) ? v : null;
}

/** Normalise un statut FNE ; toute valeur inconnue retombe sur « aucune ». */
export function normaliserStatut(valeur) {
  const v = String(valeur ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return FNE_STATUTS.includes(v) ? v : "aucune";
}

/**
 * Nettoie un identifiant KOMPTO (establishment / pointOfSale / NCC).
 * On conserve la casse : le NCC DGI comporte une lettre de contrôle
 * majuscule (ex. « 8200001A ») et KOMPTO peut être sensible à la casse.
 */
export function normaliserIdentifiant(valeur) {
  const v = String(valeur ?? "").trim();
  return v.length > 0 ? v : null;
}

/**
 * Forme canonique du NCC : majuscules, sans espace ni tiret.
 * Utilisée pour la comparaison et pour le contrôle de forme, JAMAIS pour
 * réécrire ce qui est envoyé à KOMPTO (on transmet la saisie d'origine).
 */
export function nccCanonique(valeur) {
  return String(valeur ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Contrôle de FORME du NCC (Numéro de Compte Contribuable) : 7 chiffres puis
 * une lettre de contrôle, soit 8 caractères — ex. « 8200001A », la valeur de
 * l'exemple officiel publié par KOMPTO.
 *
 * ⚠️ Ce n'est qu'un garde-fou de saisie côté client, calé sur le seul exemple
 * disponible. La VALIDITÉ réelle du NCC auprès de la DGI n'est établie que par
 * la réponse de KOMPTO (`/verify` renvoie une erreur si le NCC est invalide —
 * c'est l'un des cas de test obligatoires avant mise en production). Ne jamais
 * traiter ce contrôle comme une validation fiscale, et le revoir si le Guide
 * API v.5.3 précise le format exact.
 */
export function nccValideForme(valeur) {
  return /^[0-9]{7}[A-Z]$/.test(nccCanonique(valeur));
}

/* -------------------------------------------------------------------------- */
/* Échéance annuelle                                                           */
/* -------------------------------------------------------------------------- */

/** Ajoute `mois` à une Date sans dériver sur les fins de mois. */
function ajouterMois(date, mois) {
  const d = new Date(date.getTime());
  const jour = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + mois);
  const dernierJour = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(jour, dernierJour));
  return d;
}

/**
 * Calcule la nouvelle date d'expiration de l'option FNE.
 *
 * L'option est facturée D'AVANCE pour 12 mois. Un renouvellement anticipé
 * s'ajoute à l'échéance en cours (le commerçant ne perd pas les jours déjà
 * payés) ; un renouvellement après expiration repart de la date du jour.
 *
 * @param {Date|string|null} expirationActuelle
 * @param {Date|number} [maintenant]
 * @returns {Date}
 */
export function prochaineExpiration(expirationActuelle, maintenant = new Date()) {
  const now = maintenant instanceof Date ? maintenant : new Date(maintenant);
  const actuelle = expirationActuelle ? new Date(expirationActuelle) : null;
  const base =
    actuelle && Number.isFinite(actuelle.getTime()) && actuelle.getTime() > now.getTime()
      ? actuelle
      : now;
  return ajouterMois(base, DUREE_OPTION_FNE_MOIS);
}

/** L'option est-elle payée et non expirée ? */
export function optionValide(etablissement, maintenant = new Date()) {
  const now = maintenant instanceof Date ? maintenant : new Date(maintenant);
  if (!etablissement?.fne_expiration_date) return false;
  const fin = new Date(etablissement.fne_expiration_date);
  if (!Number.isFinite(fin.getTime())) return false;
  // La date d'expiration est inclusive : l'option couvre toute la journée.
  fin.setUTCHours(23, 59, 59, 999);
  return now.getTime() <= fin.getTime();
}

/**
 * Jours restants avant expiration (0 si expirée, `null` si aucune échéance).
 * Sert à déclencher l'alerte de renouvellement.
 *
 * Le calcul se fait de début de journée à début de journée : une échéance au
 * 10 octobre vue le 25 septembre laisse 15 jours, pas 16. L'échéance elle-même
 * est couverte (voir `optionValide`, qui l'inclut jusqu'à 23:59:59).
 */
export function joursAvantExpiration(etablissement, maintenant = new Date()) {
  if (!etablissement?.fne_expiration_date) return null;
  const now = maintenant instanceof Date ? maintenant : new Date(maintenant);
  const fin = new Date(etablissement.fne_expiration_date);
  if (!Number.isFinite(fin.getTime())) return null;
  const debutAujourdhui = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const debutEcheance = Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth(), fin.getUTCDate());
  return Math.max(0, Math.round((debutEcheance - debutAujourdhui) / 86400000));
}

/** Alerte de renouvellement à 30 jours de l'échéance. */
export const SEUIL_ALERTE_RENOUVELLEMENT_JOURS = 30;

/** Faut-il prévenir le commerçant de renouveler ? */
export function renouvellementProche(etablissement, maintenant = new Date()) {
  const jours = joursAvantExpiration(etablissement, maintenant);
  return jours !== null && jours <= SEUIL_ALERTE_RENOUVELLEMENT_JOURS;
}

/* -------------------------------------------------------------------------- */
/* Droit d'usage : peut-on émettre une facture certifiée ?                     */
/* -------------------------------------------------------------------------- */

/**
 * Identifiants KOMPTO présents pour cet établissement ?
 * Les trois sont indispensables pour appeler l'API : sans eux, KOMPTO ne sait
 * ni pour quel établissement ni pour quel point de vente certifier.
 */
export function identifiantsKomptoComplets(etablissement) {
  return Boolean(
    normaliserIdentifiant(etablissement?.fne_establishment) &&
      normaliserIdentifiant(etablissement?.fne_point_of_sale) &&
      normaliserIdentifiant(etablissement?.fne_ncc)
  );
}

/**
 * Autorisation d'émettre une facture FNE certifiée via KOMPTO.
 *
 * ⚠️ NE DÉPEND JAMAIS DU FORFAIT. Starter, Fondateur, Pro et Entreprise y ont
 * droit de la même façon : seule l'option FNE payante compte. C'est la règle
 * commerciale explicite (« disponible sur tous les plans y compris Fondateurs »)
 * et elle remplace l'ancien verrou `PLANS_FNE = ["pro","entreprise"]`.
 *
 * Conditions cumulatives :
 *   1. un choix passant par KOMPTO (« creer » ou « connecter ») ;
 *   2. le statut `active` ;
 *   3. l'option annuelle payée et non expirée ;
 *   4. les identifiants establishment / pointOfSale / NCC renseignés.
 *
 * @returns {{peutCertifier: boolean, raison: string|null, choix: string|null,
 *            statut: string, compteDgi: string|null, paye: boolean,
 *            identifiantsOk: boolean, expire: boolean, joursRestants: number|null}}
 */
export function droitFne(etablissement, maintenant = new Date()) {
  const now = maintenant instanceof Date ? maintenant : new Date(maintenant);
  const choix = normaliserChoix(etablissement?.fne_choix);
  const statut = normaliserStatut(etablissement?.fne_statut);
  const compteDgi = normaliserCompteDgi(etablissement?.fne_compte_dgi);
  const paye = optionValide(etablissement, now);
  const identifiantsOk = identifiantsKomptoComplets(etablissement);
  const joursRestants = joursAvantExpiration(etablissement, now);
  const expire = Boolean(etablissement?.fne_expiration_date) && !paye;

  const base = {
    peutCertifier: false,
    raison: null,
    choix,
    statut,
    compteDgi,
    paye,
    identifiantsOk,
    expire,
    joursRestants,
  };

  if (!choix) return { ...base, raison: "choix_absent" };

  if (!choixViaKompto(choix)) {
    // « sans_fne » : compta normale, aucun coût.
    // « methode_actuelle » : le commerçant garde sa plateforme/appli DGI ;
    //   ComptaCi ne gère que la compta interne, sans lien FNE.
    return { ...base, raison: choix === "methode_actuelle" ? "methode_externe" : "sans_fne" };
  }

  if (!paye) {
    return { ...base, raison: expire ? "option_expiree" : "option_non_payee" };
  }

  if (statut !== "active") {
    return { ...base, raison: "parcours_en_cours" };
  }

  if (!identifiantsOk) {
    return { ...base, raison: "identifiants_manquants" };
  }

  return { ...base, peutCertifier: true, raison: null };
}

/**
 * L'établissement doit-il être invité à activer l'option FNE ?
 * Sert à afficher un bandeau non bloquant — jamais une interruption de la
 * saisie : un commerçant qui a choisi « sans_fne » n'est pas harcelé.
 */
export function suggereActiverFne(etablissement, maintenant = new Date()) {
  const droit = droitFne(etablissement, maintenant);
  return !droit.peutCertifier && droit.raison !== "sans_fne" && droit.raison !== "methode_externe";
}

/**
 * Récapitulatif tarifaire de l'option FNE, pour l'affichage et les tableaux
 * de bord internes. La marge est calculée, jamais saisie en dur deux fois.
 */
export function recapitulatifTarifFne() {
  return {
    prixAnnuel: PRIX_FNE_ANNUEL,
    coutKomptoAnnuel: COUT_KOMPTO_ANNUEL,
    margeAnnuelle: MARGE_FNE_ANNUELLE,
    tauxMarge: COUT_KOMPTO_ANNUEL > 0 ? MARGE_FNE_ANNUELLE / PRIX_FNE_ANNUEL : 0,
    dureeMois: DUREE_OPTION_FNE_MOIS,
    facturation: "avance_annuelle",
  };
}
