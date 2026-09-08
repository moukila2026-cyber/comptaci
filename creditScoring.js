import { dureeEssai } from "./essai.js";
/**
 * creditScoring.js — Score de Crédit ComptaCi (Credit Scoring)
 * ---------------------------------------------------------------------------
 * Transforme les données de gestion quotidiennes d'un établissement en un
 * score de crédit sur 100, présentable à une banque ou à un institution de
 * microfinance (Advans, Baobab, Coris Bank…) comme preuve de gestion sérieuse.
 *
 * Le score est calculé CÔTÉ CLIENT à partir des données déjà chargées : aucune
 * donnée n'est envoyée à un tiers. L'établissement reste propriétaire de son
 * score et décide à qui il le présente.
 *
 * Barème (poids) :
 *   • Régularité des ventes            25 %
 *   • Tendance du chiffre d'affaires   25 %
 *   • Ratio dépenses / ventes          20 %
 *   • Ancienneté d'utilisation         15 %
 *   • Ponctualité de l'abonnement      15 %
 *
 * Paliers : Bronze (0-50), Argent (51-75), Or (76-100).
 */

const JOUR_MS = 86400000;

/** Paliers de score, du plus faible au plus élevé. */
export const PALIERS = [
  // Paliers harmonisés avec le thème sombre (cf. les jetons --cc-* de ui.css).
  { id: "bronze", min: 0, max: 50, couleur: "#C9A063", couleurFond: "rgba(201,160,99,0.15)" },
  { id: "argent", min: 51, max: 75, couleur: "#A9B8CC", couleurFond: "rgba(169,184,204,0.14)" },
  { id: "or", min: 76, max: 100, couleur: "#43C79A", couleurFond: "rgba(67,199,154,0.15)" },
];

/** Poids de chaque critère (la somme fait 100). */
export const POIDS_CRITERES = {
  regularite: 25,
  tendance: 25,
  ratio: 20,
  anciennete: 15,
  abonnement: 15,
};

/* -------------------------------------------------------------------------- */
/* Utilitaires de dates / agrégation                                           */
/* -------------------------------------------------------------------------- */

const cleMois = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const cleJour = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const debutDeMois = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

const moisPrecedent = (d) => new Date(d.getFullYear(), d.getMonth() - 1, 1);

const parseDate = (valeur) => {
  if (!valeur) return null;
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  return isNaN(d.getTime()) ? null : d;
};

const montant = (t) => Number(t?.montant) || 0;

/* -------------------------------------------------------------------------- */
/* Barèmes                                                                     */
/* -------------------------------------------------------------------------- */

/** Régularité : part des jours d'exploitation avec au moins une vente (sur 25). */
function scoreRegularite(joursAvecVentes, joursObserves) {
  if (!joursObserves || joursObserves <= 0) return { points: 0, ratio: 0 };
  const ratio = Math.min(1, joursAvecVentes / joursObserves);
  return { points: Math.round(ratio * POIDS_CRITERES.regularite), ratio };
}

/**
 * Tendance du CA : 30 derniers jours vs 30 jours précédents (sur 25).
 * On compare deux fenêtres glissantes de même durée pour ne pas pénaliser un
 * mois en cours qui ne compte que quelques jours.
 */
function scoreTendance(caMois, caMoisPrecedent) {
  let points;
  if (caMoisPrecedent <= 0) {
    // Pas d'historique : on ne pénalise pas, on ne récompense pas non plus.
    points = caMois > 0 ? 14 : 0;
  } else {
    const croissance = (caMois - caMoisPrecedent) / caMoisPrecedent;
    if (croissance >= 0.2) points = 25;
    else if (croissance >= 0.1) points = 22;
    else if (croissance >= 0) points = 18;
    else if (croissance >= -0.1) points = 12;
    else if (croissance >= -0.25) points = 7;
    else points = 3;
  }
  return { points, caMois, caMoisPrecedent };
}

/** Ratio dépenses / ventes : plus il est bas, meilleure est la gestion (sur 20). */
function scoreRatio(caTotal, depensesTotal) {
  if (caTotal <= 0) return { points: 0, taux: null };
  const taux = depensesTotal / caTotal;
  let points;
  if (taux <= 0.6) points = 20;
  else if (taux <= 0.75) points = 17;
  else if (taux <= 0.85) points = 13;
  else if (taux <= 0.95) points = 8;
  else if (taux <= 1) points = 4;
  else points = 0;
  return { points, taux };
}

/** Ancienneté d'utilisation de ComptaCi (sur 15). */
function scoreAnciennete(jours) {
  let points;
  if (jours >= 180) points = 15;
  else if (jours >= 90) points = 12;
  else if (jours >= 60) points = 9;
  else if (jours >= 30) points = 6;
  else if (jours >= 14) points = 3;
  else points = 1;
  return { points, jours: Math.max(0, Math.round(jours)) };
}

/** Ponctualité de l'abonnement ComptaCi (sur 15). */
function scoreAbonnement(etablissement, maintenant, essaiJours, demandes) {
  const abonnementActif = Boolean(etablissement?.abonnement_actif);
  const creation = parseDate(etablissement?.date_creation);
  const finEssai = creation
    ? creation.getTime() + essaiJours * JOUR_MS
    : maintenant.getTime();
  const enEssai = !abonnementActif && maintenant.getTime() < finEssai;

  let points;
  let situation;
  if (abonnementActif) {
    points = 15;
    situation = "a_jour";
  } else if (enEssai) {
    points = 11;
    situation = "en_essai";
  } else {
    points = 3;
    situation = "impaye";
  }

  // Ajustement selon l'historique des demandes de paiement, si disponible.
  const validees = (demandes || []).filter(
    (d) => String(d?.statut || "").toLowerCase() === "valide"
  ).length;
  const refusees = (demandes || []).filter(
    (d) => String(d?.statut || "").toLowerCase() === "refuse" ||
           String(d?.statut || "").toLowerCase() === "refusé"
  ).length;

  if (validees > 0 && points < 15) points = Math.min(15, points + 2);
  if (refusees > 0) points = Math.max(0, points - 3);

  return { points, situation, validees, refusees };
}

/* -------------------------------------------------------------------------- */
/* Paliers et objectifs                                                        */
/* -------------------------------------------------------------------------- */

export function palierDuScore(score) {
  return PALIERS.find((p) => score >= p.min && score <= p.max) || PALIERS[0];
}

/**
 * Objectifs de gestion suivis par l'établissement.
 * `cibleSeuil` = part maximale conseillée des dépenses dans le CA,
 * propre au secteur (sinon 85 % par défaut).
 */
function construireObjectifs({ meta, seuilDepenses, situationAbonnement }) {
  const abonnementOk = situationAbonnement === "a_jour" || situationAbonnement === "en_essai";
  return [
    {
      id: "regularite",
      valeur: Math.round(meta.regularitePct),
      cible: 80,
      unite: "%",
      atteint: meta.regularitePct >= 80,
    },
    {
      id: "croissance",
      valeur: meta.tendancePct,
      cible: 0,
      unite: "%",
      atteint: meta.tendancePct !== null && meta.tendancePct >= 0,
    },
    {
      id: "marge",
      valeur: meta.margePct,
      cible: 0,
      unite: "%",
      atteint: meta.margePct !== null && meta.margePct > 0,
    },
    {
      id: "maitrise_depenses",
      valeur: meta.tauxDepenses === null ? null : Math.round(meta.tauxDepenses * 100),
      cible: Math.round(seuilDepenses * 100),
      unite: "%",
      atteint: meta.tauxDepenses !== null && meta.tauxDepenses <= seuilDepenses,
    },
    {
      id: "anciennete",
      valeur: meta.joursAnciennete,
      cible: 90,
      unite: "j",
      atteint: meta.joursAnciennete >= 90,
    },
    {
      id: "abonnement",
      valeur: null,
      cible: null,
      unite: "",
      atteint: abonnementOk,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Calcul principal                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @param {Object}  params
 * @param {Array}   params.transactions   mouvements {type:'vente'|'depense', montant, date, categorie}
 * @param {Object}  params.etablissement  ligne `etablissements` (date_creation, abonnement_actif, essai_jours…)
 * @param {number}  [params.seuilDepenses] part max des dépenses dans le CA (défaut 0,85)
 * @param {Array}   [params.demandes]     historique `demandes_paiement` (statut)
 * @param {Date}    [params.maintenant]
 * @returns {Object} score complet, critères détaillés, objectifs et attestation
 */
export function calculerScoreCredit({
  transactions = [],
  etablissement = {},
  seuilDepenses = 0.85,
  demandes = [],
  maintenant = new Date(),
} = {}) {
  const essaiJours = dureeEssai(etablissement);
  const creation = parseDate(etablissement?.date_creation);

  /* --- Fenêtre d'observation : 90 jours, bornée par la date de création --- */
  const debutFenetre = new Date(maintenant.getTime() - 90 * JOUR_MS);
  const debutEffectif = creation && creation > debutFenetre ? creation : debutFenetre;

  const mouvements = (transactions || []).filter((t) => {
    const d = parseDate(t?.date);
    return d && d >= new Date(debutEffectif.getFullYear(), debutEffectif.getMonth(), debutEffectif.getDate());
  });

  /* --- 1. Régularité des ventes (25) : sur les 30 derniers jours --- */
  const debut30 = new Date(maintenant.getTime() - 29 * JOUR_MS);
  const debut30Effectif = creation && creation > debut30 ? creation : debut30;
  const joursObserves =
    Math.floor((maintenant.getTime() - debut30Effectif.getTime()) / JOUR_MS) + 1;

  const joursAvecVentes = new Set(
    mouvements
      .filter((t) => t?.type === "vente")
      .map((t) => cleJour(parseDate(t.date)))
      .filter((d) => {
        const dt = new Date(d + "T00:00:00");
        return dt >= new Date(debut30Effectif.getFullYear(), debut30Effectif.getMonth(), debut30Effectif.getDate());
      })
  ).size;

  const regularite = scoreRegularite(joursAvecVentes, joursObserves);

  /* --- 2. Tendance du CA (25) : 30 derniers jours vs 30 jours précédents --- */
  const dansLes30DerniersJours = (t) => {
    const d = parseDate(t.date);
    return d && d >= debut30Effectif && d <= maintenant;
  };
  const dansLes30JoursAvant = (t) => {
    const d = parseDate(t.date);
    if (!d) return false;
    const debut60 = new Date(debut30Effectif.getTime() - 30 * JOUR_MS);
    return d >= debut60 && d < debut30Effectif;
  };

  const caMois = (transactions || [])
    .filter((t) => t.type === "vente" && dansLes30DerniersJours(t))
    .reduce((a, t) => a + montant(t), 0);
  const depMois = (transactions || [])
    .filter((t) => t.type === "depense" && dansLes30DerniersJours(t))
    .reduce((a, t) => a + montant(t), 0);
  const caMoisPrecedent = (transactions || [])
    .filter((t) => t.type === "vente" && dansLes30JoursAvant(t))
    .reduce((a, t) => a + montant(t), 0);

  const tendance = scoreTendance(caMois, caMoisPrecedent);

  /* --- 3. Ratio dépenses / ventes (20) : sur les 90 derniers jours --- */
  const caFenetre = mouvements
    .filter((t) => t.type === "vente")
    .reduce((a, t) => a + montant(t), 0);
  const depFenetre = mouvements
    .filter((t) => t.type === "depense")
    .reduce((a, t) => a + montant(t), 0);
  const ratio = scoreRatio(caFenetre, depFenetre);

  /* --- 4. Ancienneté (15) --- */
  const joursAnciennete = creation
    ? Math.max(0, Math.floor((maintenant.getTime() - creation.getTime()) / JOUR_MS))
    : 0;
  const anciennete = scoreAnciennete(joursAnciennete);

  /* --- 5. Ponctualité de l'abonnement (15) --- */
  const abonnement = scoreAbonnement(etablissement, maintenant, essaiJours, demandes);

  /* --- Score global --- */
  const criteres = [
    { id: "regularite", points: regularite.points, max: POIDS_CRITERES.regularite },
    { id: "tendance", points: tendance.points, max: POIDS_CRITERES.tendance },
    { id: "ratio", points: ratio.points, max: POIDS_CRITERES.ratio },
    { id: "anciennete", points: anciennete.points, max: POIDS_CRITERES.anciennete },
    { id: "abonnement", points: abonnement.points, max: POIDS_CRITERES.abonnement },
  ];

  const score = Math.max(
    0,
    Math.min(100, criteres.reduce((a, c) => a + c.points, 0))
  );
  const palier = palierDuScore(score);

  /* --- Méta-données affichées au gérant --- */
  const margePct = caFenetre > 0 ? ((caFenetre - depFenetre) / caFenetre) * 100 : null;
  const tendancePct =
    caMoisPrecedent > 0 ? ((caMois - caMoisPrecedent) / caMoisPrecedent) * 100 : null;

  const meta = {
    joursObserves,
    joursAvecVentes,
    regularitePct: regularite.ratio * 100,
    caMois,
    depMois,
    caMoisPrecedent,
    caFenetre,
    depFenetre,
    margePct,
    tendancePct,
    tauxDepenses: ratio.taux,
    joursAnciennete,
    essaiJours,
    nbMouvements: mouvements.length,
    fenetreJours: 90,
  };

  const objectifs = construireObjectifs({
    meta,
    seuilDepenses,
    situationAbonnement: abonnement.situation,
  });
  const objectifsAtteints = objectifs.filter((o) => o.atteint).length;

  /* --- Évolution mensuelle (6 derniers mois) pour le graphique --- */
  const evolution = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    const cle = cleMois(d);
    const ca = (transactions || [])
      .filter((t) => t.type === "vente" && parseDate(t.date) && cleMois(parseDate(t.date)) === cle)
      .reduce((a, t) => a + montant(t), 0);
    const dep = (transactions || [])
      .filter((t) => t.type === "depense" && parseDate(t.date) && cleMois(parseDate(t.date)) === cle)
      .reduce((a, t) => a + montant(t), 0);
    evolution.push({ cle, mois: cle, ca, depenses: dep, resultat: ca - dep });
  }

  return {
    score,
    palier,
    criteres,
    objectifs,
    objectifsAtteints,
    objectifsTotal: objectifs.length,
    meta,
    evolution,
    situationAbonnement: abonnement.situation,
    genereLe: maintenant.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Attestation présentable à une banque                                        */
/* -------------------------------------------------------------------------- */

const fmtNombre = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/**
 * Texte d'attestation à copier / envoyer à un établissement de crédit.
 * Volontairement factuel : reprend les données réelles et le barème.
 */
export function attestationScore({ resultat, etablissement, secteurLabel }) {
  const m = resultat.meta;
  const lignes = [
    `ATTESTATION DE GESTION — SCORE COMPTACI`,
    ``,
    `Établissement : ${etablissement?.nom || "—"}`,
    `Type d'activité : ${secteurLabel || "—"}`,
    `Édité le : ${fmtDate(resultat.genereLe)}`,
    ``,
    `Score de crédit ComptaCi : ${resultat.score}/100 — palier ${resultat.palier.id.toUpperCase()}`,
    `Objectifs de gestion atteints : ${resultat.objectifsAtteints}/${resultat.objectifsTotal}`,
    ``,
    `Chiffre d'affaires (90 derniers jours) : ${fmtNombre(m.caFenetre)} FCFA`,
    `Dépenses (90 derniers jours) : ${fmtNombre(m.depFenetre)} FCFA`,
    m.margePct !== null ? `Marge nette : ${m.margePct.toFixed(1)} %` : `Marge nette : non calculable`,
    `Jours d'exploitation avec ventes : ${m.joursAvecVentes}/${m.joursObserves} (${Math.round(m.regularitePct)} %)`,
    `Ancienneté sur ComptaCi : ${m.joursAnciennete} jours`,
    ``,
    `Barème : régularité des ventes 25 pts · tendance du CA 25 pts · ratio dépenses/ventes 20 pts · ancienneté 15 pts · ponctualité d'abonnement 15 pts.`,
    ``,
    `Les chiffres ci-dessus proviennent des enregistrements quotidiens de l'établissement sur ComptaCi.`,
  ];
  return lignes.join("\n");
}

export { fmtNombre };
