import { DEPENSES_PAR_ACTIVITE } from "./depensesActivites.js";
import { ANCIENS_SECTEURS } from "./anciensPostes.js";

/**
 * secteurs.js — Types d'établissement ComptaCi
 * ---------------------------------------------------------------------------
 * Source unique de vérité pour :
 *   • la liste des types d'établissement (menu déroulant à la création),
 *   • les catégories de dépenses propres à chaque activité,
 *   • les POSTES DE DÉPENSE RÉELS (20 par type) affichés dans la
 *     « Répartition des dépenses » du tableau de bord,
 *   • les seuils de gestion (ratios achats / personnel / charges) et la marge
 *     cible indicative de chaque métier.
 *
 * Un « poste » = une dépense concrète que le gérant reconnaît immédiatement
 * (« loyer », « maintenance », « frais de livraison »…). Chaque poste est rattaché
 * à une catégorie, elle-même rattachée à une grande nature de poste
 * (achats / personnel / charges / autre) utilisée par les ratios du dashboard.
 */

/* -------------------------------------------------------------------------- */
/* 1. Types d'établissement                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Identifiants stables, au format snake_case, stockés en base
 * (colonne `etablissements.secteur`).
 */
export const SECTEURS_IDS = [
  "restaurant",
  "bar",
  "maquis",
  "hotel",
  "quincaillerie",
  "boutique",
  "salon_beaute",
  "accessoires_telephone",
  "vetements",
  "pharmacie",
];

/**
 * Anciens identifiants encore présents en base vers les nouveaux types.
 * `restauration` (l'ancien fourre-tout) est requalifié en `restaurant`.
 */
const ALIAS_SECTEURS = {
  restauration: "restaurant",
  alimentation: "boutique",
  superette: "boutique",
  epicerie: "boutique",
  coiffure: "salon_beaute",
  salon: "salon_beaute",
  beaute: "salon_beaute",
  telephone: "accessoires_telephone",
  accessoires: "accessoires_telephone",
  habillement: "vetements",
  quincaillerie_general: "quincaillerie",
};

/** Secteur de repli si la valeur rencontrée est inconnue. */
export const SECTEUR_PAR_DEFAUT = "restaurant";

/** Normalise un secteur lu depuis la base (alias, casse, espaces). */
export function secteurNormalise(secteur) {
  const brut = String(secteur || "").trim().toLowerCase();
  if (!brut) return SECTEUR_PAR_DEFAUT;
  if (SECTEURS_IDS.includes(brut)) return brut;
  if (ALIAS_SECTEURS[brut]) return ALIAS_SECTEURS[brut];
  return SECTEUR_PAR_DEFAUT;
}

/** Liste traduite des types, pour les menus déroulants. */
export function secteursTraduits(t) {
  return SECTEURS_IDS.map((id) => ({ id, label: t(`secteur_${id}`) }));
}

/* -------------------------------------------------------------------------- */
/* 2. Catégories et postes de dépenses par type d'établissement                */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {{id: string, label: string, categorie: string, mots?: string[]}} Poste
 *
 * `mots` = variantes de saisie tolérées (« javell », « maggi », « verre trempé »…).
 * Elles servent à rattacher une dépense déjà saisie à son poste de rattachement.
 */
export const SECTEURS = DEPENSES_PAR_ACTIVITE;

/** Références stockables seulement : aucun loyer, salaire ou prestation. */
const IDS_STOCK = {
  restaurant: 'riz huile viande poisson legumes tomates epices charbon gaz sodas eau_minerale bieres pain lait feculents nettoyage emballages',
  bar: 'bieres alcools_forts vins sodas eau_minerale glacons charcuterie snacks cigarettes consignes nettoyage serviettes',
  maquis: 'attieke alloco poisson viande riz huile condiments charbon sodas bieres eau glacons epices serviettes nettoyage',
  hotel: 'draps serviettes accueil nettoyage javel petit_dej minibar cafe bureau',
  quincaillerie: 'ciment fer toles bois peinture_prod pinceaux clous outillage_achat disques cables appareillage ampoules pvc robinets colle carrelage serrures epi sable',
  boutique: 'biscuits javel savon bonbons yaourt eau_5l riz huile sucre lait_poudre sardines pates sachets piles allumettes bougies cafe tomate_concentre maggi papier_hygiénique lait_boite lessive farine sel',
  salon_beaute: 'faux_ongles faux_cils vernis perruques meches dissolvant gel defrisant shampoing apres_shampoing colorants huile gants serviettes peignes rasoirs blanchiment soin_visage coton alcool colle bigoudis',
  accessoires_telephone: 'coques verre_trempe chargeurs cables ecouteurs powerbanks enceintes supports cartes_memoire cles_usb adaptateurs pochettes montres occasion pieces outils vente_gros sacs_clients',
  vetements: 'tshirts robes pantalons chemises chaussures_achat sandales sous_vetements sacs bijoux foulards pagnes enfants cintres sacs_emballage etiquettes mannequins',
  pharmacie: 'generiques marque antipalu antalgiques antibiotiques sirops desinfectants pansements gants seringues tests preservatifs vitamines pommades hygiene_intime materiel emballages',
};

/** Catalogue distinct de marchandises, matières premières et consommables stockables. */
export function produitsDuSecteur(secteur) {
  const cle = secteurNormalise(secteur);
  const ids = new Set(IDS_STOCK[cle].split(' '));
  return ANCIENS_SECTEURS[cle].postes.filter((p) => ids.has(p.id));
}

/** Catégories historiques pour lecture/édition, jamais pour les suggestions. */
export function categoriesHistoriquesDuSecteur(secteur) {
  const courantes = categoriesDuSecteur(secteur);
  return [...courantes, ...ANCIENS_SECTEURS[secteurNormalise(secteur)].categories
    .filter((c) => !courantes.some((actuelle) => actuelle.id === c.id))];
}

/* -------------------------------------------------------------------------- */
/* 3. Accesseurs                                                               */
/* -------------------------------------------------------------------------- */

/** Catégories d'un secteur (fallback : restaurant). */
export function categoriesDuSecteur(secteur) {
  const cle = secteurNormalise(secteur);
  return SECTEURS[cle]?.categories || SECTEURS[SECTEUR_PAR_DEFAUT].categories;
}

/** Les 20 postes de dépense réels d'un secteur (fallback : restaurant). */
export function postesDuSecteur(secteur) {
  const cle = secteurNormalise(secteur);
  return SECTEURS[cle]?.postes || SECTEURS[SECTEUR_PAR_DEFAUT].postes;
}

/** Libellé lisible d'un poste à partir de son identifiant. */
export function libellePoste(secteur, idPoste) {
  return postesDuSecteur(secteur).find((p) => p.id === idPoste)?.label
    || ANCIENS_SECTEURS[secteurNormalise(secteur)].postes.find((p) => p.id === idPoste)?.label
    || "";
}

/** Retire accents, ponctuation et espaces superflus pour comparer deux textes. */
export function normaliser(texte) {
  return String(texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Rattache une désignation saisie librement à un poste du secteur.
 * Retourne le poste trouvé (objet) ou `null`.
 */
export function posteDeDesignation(secteur, designation) {
  const texte = normaliser(designation);
  if (!texte) return null;
  const postes = postesDuSecteur(secteur);
  // 1. correspondance exacte sur le libellé
  const exact = postes.find((p) => normaliser(p.label) === texte);
  if (exact) return exact;
  // 2. correspondance sur un mot-clé (le plus long d'abord, pour éviter
  //    que « eau » capte « eau de javel »)
  const mots = postes
    .flatMap((p) => [normaliser(p.label), ...(p.mots || []).map(normaliser)])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const mot of mots) {
    if (` ${texte} `.includes(` ${mot} `)) {
      return postes.find((p) => normaliser(p.label) === mot || (p.mots || []).map(normaliser).includes(mot)) || null;
    }
  }
  return null;
}

/** Catégorie suggérée pour une désignation libre (sinon « autre »). */
export function categorieSuggeree(secteur, designation) {
  const poste = posteDeDesignation(secteur, designation);
  if (poste) return poste.categorie;
  const connues = categoriesDuSecteur(secteur).map((c) => c.id);
  return connues.includes("autre") ? "autre" : connues[0];
}

/* -------------------------------------------------------------------------- */
/* 4. Nature des catégories (achats / personnel / charges / autre)             */
/* -------------------------------------------------------------------------- */

export const POSTES_PAR_CATEGORIE = {
  // Achats / approvisionnements
  achats_alimentaires: "achats",
  approvisionnement: "achats",
  restauration: "achats",
  alimentaire: "achats",
  hygiene: "achats",
  boissons: "achats",
  consommables: "achats",
  consommables_chambres: "achats",
  linge_entretien: "achats",
  produits_beaute: "achats",
  materiaux: "achats",
  outillage: "achats",
  plomberie: "achats",
  electricite: "achats",
  peinture: "achats",
  emballages: "achats",
  accessoires: "achats",
  reparation: "achats",
  vetements: "achats",
  chaussures: "achats",
  materiel: "achats",
  medicaments: "achats",
  parapharmacie: "achats",
  materiel_medical: "achats",
  // Masse salariale
  personnel: "personnel",
  // Charges de structure
  charges_fixes: "charges",
  entretien_exploitation: "charges",
  logistique: "charges",
  services_exterieurs: "charges",
  consommables_exploitation: "charges",
  // Non ventilé
  autre: "autre",
};

/** Nature comptable d'une catégorie (achats par défaut si inconnue). */
export function natureCategorie(categorie) {
  return POSTES_PAR_CATEGORIE[categorie] || "autre";
}

/* -------------------------------------------------------------------------- */
/* 5. Seuils de bonne gestion et marge cible, par métier                       */
/* -------------------------------------------------------------------------- */

/** Poids maximum conseillé de chaque poste, en % du chiffre d'affaires. */
export const SEUILS_RATIOS = {
  restaurant: { achats: 40, personnel: 20, charges: 15 },
  bar: { achats: 55, personnel: 15, charges: 15 },
  maquis: { achats: 50, personnel: 18, charges: 15 },
  hotel: { achats: 30, personnel: 25, charges: 25 },
  quincaillerie: { achats: 70, personnel: 12, charges: 15 },
  boutique: { achats: 75, personnel: 12, charges: 12 },
  salon_beaute: { achats: 30, personnel: 30, charges: 20 },
  accessoires_telephone: { achats: 65, personnel: 12, charges: 15 },
  vetements: { achats: 60, personnel: 15, charges: 15 },
  pharmacie: { achats: 65, personnel: 15, charges: 15 },
  // Ancien identifiant conservé pour la rétro-compatibilité
  restauration: { achats: 40, personnel: 20, charges: 15 },
};

/** Marge brute indicative attendue dans le métier. */
export const MARGE_CIBLE = {
  restaurant: "55 – 65 %",
  bar: "35 – 45 %",
  maquis: "40 – 55 %",
  hotel: "60 – 75 %",
  quincaillerie: "20 – 30 %",
  boutique: "15 – 25 %",
  salon_beaute: "60 – 75 %",
  accessoires_telephone: "30 – 40 %",
  vetements: "35 – 50 %",
  pharmacie: "25 – 35 %",
  restauration: "55 – 65 %",
};

export function seuilsDuSecteur(secteur) {
  const cle = secteurNormalise(secteur);
  return SEUILS_RATIOS[cle] || SEUILS_RATIOS[SECTEUR_PAR_DEFAUT];
}

export function margeCibleDuSecteur(secteur) {
  const cle = secteurNormalise(secteur);
  return MARGE_CIBLE[cle] || MARGE_CIBLE[SECTEUR_PAR_DEFAUT];
}

/* -------------------------------------------------------------------------- */
/* 6. Compatibilité avec l'ancien format (CATEGORIES_PAR_SECTEUR)              */
/* -------------------------------------------------------------------------- */

export const CATEGORIES_PAR_SECTEUR = Object.fromEntries(
  Object.entries(SECTEURS).map(([id, cfg]) => [id, cfg.categories])
);
