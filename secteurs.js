/**
 * secteurs.js — Types d'établissement ComptaCi
 * ---------------------------------------------------------------------------
 * Source unique de vérité pour :
 *   • la liste des types d'établissement (menu déroulant à la création),
 *   • les catégories de dépenses propres à chaque activité,
 *   • les POSTES DE DÉPENSE RÉELS (20 minimum par type) affichés dans la
 *     « Répartition des dépenses » du tableau de bord,
 *   • les seuils de gestion (ratios achats / personnel / charges) et la marge
 *     cible indicative de chaque métier.
 *
 * Un « poste » = une dépense concrète que le gérant reconnaît immédiatement
 * (« biscuits », « eau de javel », « faux ongles »…). Chaque poste est rattaché
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
export const SECTEURS = {
  /* ---------------------------------------------------------------- RESTAURANT */
  restaurant: {
    categories: [
      { id: "achats_alimentaires", label: "Achats alimentaires" },
      { id: "boissons", label: "Boissons" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "riz", label: "Riz (sac)", categorie: "achats_alimentaires", mots: ["riz"] },
      { id: "huile", label: "Huile de cuisine", categorie: "achats_alimentaires", mots: ["huile"] },
      { id: "viande", label: "Viande / volaille", categorie: "achats_alimentaires", mots: ["viande", "poulet", "boeuf", "bœuf", "mouton"] },
      { id: "poisson", label: "Poisson frais", categorie: "achats_alimentaires", mots: ["poisson", "tilapia", "thon"] },
      { id: "legumes", label: "Légumes & condiments", categorie: "achats_alimentaires", mots: ["legume", "légume", "aubergine", "gombo"] },
      { id: "tomates", label: "Tomates & oignons", categorie: "achats_alimentaires", mots: ["tomate", "oignon"] },
      { id: "epices", label: "Épices & cubes Maggi", categorie: "achats_alimentaires", mots: ["epice", "épice", "maggi", "cube", "poivre", "sel"] },
      { id: "charbon", label: "Charbon / bois de cuisson", categorie: "achats_alimentaires", mots: ["charbon", "bois"] },
      { id: "gaz", label: "Gaz (bouteille)", categorie: "charges_fixes", mots: ["gaz", "butane"] },
      { id: "sodas", label: "Boissons gazeuses", categorie: "boissons", mots: ["soda", "coca", "fanta", "gazeuse", "limonade"] },
      { id: "eau_minerale", label: "Eau minérale", categorie: "boissons", mots: ["eau minerale", "eau minérale"] },
      { id: "bieres", label: "Bières & alcools", categorie: "boissons", mots: ["biere", "bière", "alcool", "vin", "whisky"] },
      { id: "pain", label: "Pain", categorie: "achats_alimentaires", mots: ["pain", "baguette"] },
      { id: "lait", label: "Lait & produits laitiers", categorie: "achats_alimentaires", mots: ["lait", "fromage", "yaourt"] },
      { id: "feculents", label: "Farine & pâtes", categorie: "achats_alimentaires", mots: ["farine", "pate", "pâte", "spaghetti", "macaroni"] },
      { id: "nettoyage", label: "Produits de nettoyage (javel, savon)", categorie: "autre", mots: ["javel", "javell", "savon", "nettoyage", "detergent", "détergent"] },
      { id: "emballages", label: "Emballages & sachets plastiques", categorie: "autre", mots: ["emballage", "sachet", "boite", "boîte"] },
      { id: "salaires", label: "Salaires du personnel", categorie: "personnel", mots: ["salaire", "paye", "prime", "cuisinier", "serveuse", "serveuses"] },
      { id: "transport", label: "Transport & livraison", categorie: "autre", mots: ["transport", "livraison", "essence", "carburant"] },
      { id: "eau_electricite", label: "Électricité & eau (factures)", categorie: "charges_fixes", mots: ["electricite", "électricité", "edf", "cie", "facture eau", "eau"] },
      { id: "loyer", label: "Loyer du local", categorie: "charges_fixes", mots: ["loyer", "bail"] },
      { id: "entretien", label: "Entretien du matériel de cuisine", categorie: "charges_fixes", mots: ["entretien", "reparation", "réparation", "materiel", "matériel"] },
    ],
  },

  /* ---------------------------------------------------------------------- BAR */
  bar: {
    categories: [
      { id: "boissons", label: "Boissons & alcools" },
      { id: "consommables", label: "Consommables" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "bieres", label: "Bières (Flag, Beaufort…)", categorie: "boissons", mots: ["biere", "bière", "flag", "beaufort", "guinness", "heineken"] },
      { id: "alcools_forts", label: "Alcools forts (whisky, gin)", categorie: "boissons", mots: ["whisky", "gin", "rhum", "vodka", "alcool fort"] },
      { id: "vins", label: "Vins & liqueurs", categorie: "boissons", mots: ["vin", "liqueur", "champagne"] },
      { id: "sodas", label: "Sodas & jus", categorie: "boissons", mots: ["soda", "jus", "coca", "fanta", "schweppes"] },
      { id: "eau_minerale", label: "Eau minérale", categorie: "boissons", mots: ["eau minerale", "eau minérale"] },
      { id: "glacons", label: "Glace & glaçons", categorie: "consommables", mots: ["glace", "glaçon", "glacons"] },
      { id: "charcuterie", label: "Charcuterie & amuse-gueules", categorie: "consommables", mots: ["charcuterie", "jambon", "saucisson", "amuse"] },
      { id: "snacks", label: "Cacahuètes & snacks", categorie: "consommables", mots: ["cacahuete", "cacahuète", "arachide", "snack", "chips"] },
      { id: "cigarettes", label: "Cigarettes", categorie: "consommables", mots: ["cigarette", "tabac"] },
      { id: "consignes", label: "Verres & bouteilles consignées", categorie: "consommables", mots: ["consigne", "verre", "bouteille", "casier"] },
      { id: "nettoyage", label: "Produits de nettoyage (verres)", categorie: "consommables", mots: ["nettoyage", "javel", "liquide vaisselle", "produit"] },
      { id: "electricite", label: "Électricité (congélateur, clim)", categorie: "charges_fixes", mots: ["electricite", "électricité", "cie", "facture"] },
      { id: "frais_froid", label: "Entretien frigo & congélateur", categorie: "charges_fixes", mots: ["frigo", "congelateur", "congélateur", "froid", "clim"] },
      { id: "salaires", label: "Salaires barmen & serveuses", categorie: "personnel", mots: ["salaire", "paye", "barman", "serveuse", "serveuses"] },
      { id: "animation", label: "Musique & animation (DJ)", categorie: "charges_fixes", mots: ["dj", "musique", "animation", "sono"] },
      { id: "loyer", label: "Loyer du local", categorie: "charges_fixes", mots: ["loyer", "bail"] },
      { id: "patente", label: "Licence, patente & taxes", categorie: "charges_fixes", mots: ["patente", "licence", "taxe", "impot", "impôt", "dgi"] },
      { id: "securite", label: "Sécurité & gardiennage", categorie: "charges_fixes", mots: ["securite", "sécurité", "gardien", "gardiennage"] },
      { id: "serviettes", label: "Serviettes & essuie-verres", categorie: "consommables", mots: ["serviette", "essuie", "papier"] },
      { id: "transport", label: "Transport des boissons", categorie: "autre", mots: ["transport", "livraison", "carburant", "essence"] },
      { id: "mobilier", label: "Mobilier & décoration (tabourets, chaises)", categorie: "charges_fixes", mots: ["chaise", "tabouret", "table", "mobilier", "deco", "déco"] },
    ],
  },

  /* ------------------------------------------------------------------- MAQUIS */
  maquis: {
    categories: [
      { id: "approvisionnement", label: "Approvisionnement" },
      { id: "boissons", label: "Boissons" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "attieke", label: "Attiéké", categorie: "approvisionnement", mots: ["attieke", "attiéké", "manioc"] },
      { id: "alloco", label: "Bananes plantains / alloco", categorie: "approvisionnement", mots: ["alloco", "banane", "plantain"] },
      { id: "poisson", label: "Poisson (tilapia, sardine)", categorie: "approvisionnement", mots: ["poisson", "tilapia", "sardine", "maquereau"] },
      { id: "viande", label: "Viande & poulet", categorie: "approvisionnement", mots: ["viande", "poulet", "mouton", "boeuf", "bœuf"] },
      { id: "riz", label: "Riz & sauces", categorie: "approvisionnement", mots: ["riz", "sauce", "graine"] },
      { id: "huile", label: "Huile de cuisson", categorie: "approvisionnement", mots: ["huile"] },
      { id: "condiments", label: "Tomate, oignon, piment", categorie: "approvisionnement", mots: ["tomate", "oignon", "piment", "condiment"] },
      { id: "charbon", label: "Charbon de bois", categorie: "approvisionnement", mots: ["charbon", "bois"] },
      { id: "sodas", label: "Boissons gazeuses", categorie: "boissons", mots: ["soda", "coca", "fanta", "gazeuse"] },
      { id: "bieres", label: "Bières", categorie: "boissons", mots: ["biere", "bière", "flag", "beaufort"] },
      { id: "eau", label: "Eau en sachet / bouteille", categorie: "boissons", mots: ["eau sachet", "eau", "sachet d'eau"] },
      { id: "glacons", label: "Glaçons", categorie: "approvisionnement", mots: ["glace", "glaçon", "glacons"] },
      { id: "epices", label: "Cubes Maggi & épices", categorie: "approvisionnement", mots: ["maggi", "cube", "epice", "épice"] },
      { id: "serviettes", label: "Serviettes & sachets", categorie: "autre", mots: ["serviette", "sachet", "emballage"] },
      { id: "nettoyage", label: "Produits de nettoyage", categorie: "autre", mots: ["nettoyage", "javel", "javell", "savon", "detergent"] },
      { id: "salaires", label: "Salaires cuisinier & serveuses", categorie: "personnel", mots: ["salaire", "paye", "cuisinier", "cuisiniere", "serveuse"] },
      { id: "loyer", label: "Loyer", categorie: "charges_fixes", mots: ["loyer", "bail"] },
      { id: "electricite", label: "Électricité", categorie: "charges_fixes", mots: ["electricite", "électricité", "cie", "facture"] },
      { id: "transport", label: "Transport & approvisionnement", categorie: "autre", mots: ["transport", "carburant", "essence", "livraison"] },
      { id: "entretien", label: "Entretien & réparation du matériel", categorie: "charges_fixes", mots: ["entretien", "reparation", "réparation", "marmite", "materiel"] },
      { id: "taxes", label: "Taxes & patente locale", categorie: "charges_fixes", mots: ["taxe", "patente", "impot", "impôt", "mairie"] },
    ],
  },

  /* -------------------------------------------------------------------- HÔTEL */
  hotel: {
    categories: [
      { id: "linge_entretien", label: "Linge & entretien" },
      { id: "consommables_chambres", label: "Consommables chambres" },
      { id: "restauration", label: "Restauration" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "draps", label: "Draps & taies d'oreiller", categorie: "linge_entretien", mots: ["drap", "taie", "couette"] },
      { id: "serviettes", label: "Serviettes de bain", categorie: "linge_entretien", mots: ["serviette"] },
      { id: "accueil", label: "Produits d'accueil (savon, shampoing)", categorie: "consommables_chambres", mots: ["accueil", "savon", "shampoing", "shampooing", "gel douche"] },
      { id: "nettoyage", label: "Produits de nettoyage des chambres", categorie: "linge_entretien", mots: ["nettoyage", "produit", "detergent", "détergent"] },
      { id: "javel", label: "Eau de Javel & désinfectants", categorie: "linge_entretien", mots: ["javel", "javell", "desinfectant", "désinfectant"] },
      { id: "petit_dej", label: "Approvisionnement petit-déjeuner", categorie: "restauration", mots: ["petit dejeuner", "petit-déjeuner", "dejeuner"] },
      { id: "minibar", label: "Boissons minibar", categorie: "restauration", mots: ["minibar", "boisson"] },
      { id: "cafe", label: "Café, thé, sucre", categorie: "restauration", mots: ["cafe", "café", "the", "thé", "sucre"] },
      { id: "clim", label: "Électricité (climatisation)", categorie: "charges_fixes", mots: ["electricite", "électricité", "clim", "facture"] },
      { id: "eau", label: "Facture d'eau", categorie: "charges_fixes", mots: ["eau", "sodeci"] },
      { id: "blanchisserie", label: "Blanchisserie du linge", categorie: "linge_entretien", mots: ["blanchisserie", "linge", "pressing", "laver"] },
      { id: "reception", label: "Salaires réceptionnistes", categorie: "personnel", mots: ["reception", "réception", "receptionniste", "salaire"] },
      { id: "femmes_chambre", label: "Salaires femmes de chambre", categorie: "personnel", mots: ["femme de chambre", "menage", "ménage", "salaire"] },
      { id: "gardiennage", label: "Gardiennage & sécurité", categorie: "charges_fixes", mots: ["gardien", "gardiennage", "securite", "sécurité"] },
      { id: "maintenance_clim", label: "Maintenance climatisations", categorie: "charges_fixes", mots: ["maintenance", "clim", "climatiseur"] },
      { id: "plomberie", label: "Plomberie & sanitaires", categorie: "charges_fixes", mots: ["plomberie", "sanitaire", "robinet", "fuite"] },
      { id: "internet_tv", label: "Internet & TV (abonnement)", categorie: "charges_fixes", mots: ["internet", "wifi", "tv", "canal", "abonnement"] },
      { id: "loyer", label: "Loyer / bail", categorie: "charges_fixes", mots: ["loyer", "bail"] },
      { id: "licence", label: "Licence touristique & taxes", categorie: "charges_fixes", mots: ["licence", "tourisme", "taxe", "impot", "impôt"] },
      { id: "bureau", label: "Consommables bureau & réception", categorie: "autre", mots: ["bureau", "papier", "stylo", "fourniture"] },
      { id: "assurance", label: "Assurances", categorie: "charges_fixes", mots: ["assurance"] },
    ],
  },

  /* ------------------------------------------------------------- QUINCAILLERIE */
  quincaillerie: {
    categories: [
      { id: "materiaux", label: "Matériaux de construction" },
      { id: "outillage", label: "Outillage" },
      { id: "plomberie", label: "Plomberie" },
      { id: "electricite", label: "Électricité" },
      { id: "peinture", label: "Peinture & finitions" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "ciment", label: "Ciment (sacs)", categorie: "materiaux", mots: ["ciment"] },
      { id: "fer", label: "Fer à béton", categorie: "materiaux", mots: ["fer", "beton", "béton", "rond"] },
      { id: "toles", label: "Tôles & tôle bac", categorie: "materiaux", mots: ["tole", "tôle", "bac"] },
      { id: "bois", label: "Bois de charpente & planches", categorie: "materiaux", mots: ["bois", "planche", "charpente", "contreplaque"] },
      { id: "peinture_prod", label: "Peinture & enduits", categorie: "peinture", mots: ["peinture", "enduit"] },
      { id: "pinceaux", label: "Pinceaux & rouleaux", categorie: "peinture", mots: ["pinceau", "rouleau", "brosse"] },
      { id: "clous", label: "Clous & vis", categorie: "materiaux", mots: ["clou", "vis", "boulon", "cheville"] },
      { id: "outillage_achat", label: "Outillage (marteaux, perceuses)", categorie: "outillage", mots: ["marteau", "perceuse", "outil", "outillage", "cle", "clé"] },
      { id: "disques", label: "Disques de coupe & consommables", categorie: "outillage", mots: ["disque", "meule", "foret", "lame"] },
      { id: "cables", label: "Câbles électriques", categorie: "electricite", mots: ["cable", "câble", "fil electrique"] },
      { id: "appareillage", label: "Interrupteurs & prises", categorie: "electricite", mots: ["interrupteur", "prise", "disjoncteur", "tableau"] },
      { id: "ampoules", label: "Ampoules & lampes", categorie: "electricite", mots: ["ampoule", "lampe", "led", "spot"] },
      { id: "pvc", label: "Tubes PVC & raccords", categorie: "plomberie", mots: ["pvc", "tube", "raccord", "canalisation"] },
      { id: "robinets", label: "Robinets & flexibles", categorie: "plomberie", mots: ["robinet", "flexible", "mitigeur", "lavabo"] },
      { id: "colle", label: "Colle & mastics", categorie: "peinture", mots: ["colle", "mastic", "silicone"] },
      { id: "carrelage", label: "Carreaux & carrelage", categorie: "materiaux", mots: ["carreau", "carrelage", "faience", "faïence"] },
      { id: "serrures", label: "Serrures & cadenas", categorie: "outillage", mots: ["serrure", "cadenas", "cle", "clé", "verrou"] },
      { id: "epi", label: "Gants & équipements de chantier", categorie: "outillage", mots: ["gant", "casque", "equipement", "équipement", "botte", "masque"] },
      { id: "sable", label: "Sable & gravier (transport)", categorie: "materiaux", mots: ["sable", "gravier", "caillou", "agregat", "agrégat"] },
      { id: "salaires", label: "Salaires du personnel", categorie: "personnel", mots: ["salaire", "paye", "vendeur", "magasinier"] },
      { id: "loyer", label: "Loyer du dépôt", categorie: "charges_fixes", mots: ["loyer", "bail", "depot", "dépôt"] },
      { id: "transport", label: "Transport & livraison marchandises", categorie: "autre", mots: ["transport", "livraison", "carburant", "essence", "dechargement"] },
    ],
  },

  /* --------------------------------------------------- BOUTIQUE / ÉPICERIE     */
  /* Le type « Boutique (épicerie / supérette) » couvre les commerces de         */
  /* proximité type « la boutique de Diallo » : biscuits, javel, savon…          */
  boutique: {
    categories: [
      { id: "alimentaire", label: "Produits alimentaires" },
      { id: "hygiene", label: "Produits d'hygiène" },
      { id: "boissons", label: "Boissons" },
      { id: "emballages", label: "Emballages" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "biscuits", label: "Biscuits", categorie: "alimentaire", mots: ["biscuit", "gateau", "gâteau"] },
      { id: "javel", label: "Eau de Javel", categorie: "hygiene", mots: ["javel", "javell"] },
      { id: "savon", label: "Savon", categorie: "hygiene", mots: ["savon"] },
      { id: "bonbons", label: "Bonbons", categorie: "alimentaire", mots: ["bonbon", "sucrerie", "chewing"] },
      { id: "yaourt", label: "Yaourt", categorie: "alimentaire", mots: ["yaourt", "yogourt", "lait caillé"] },
      { id: "eau_5l", label: "Bouteille d'eau 5 litres", categorie: "boissons", mots: ["5 litre", "5l", "eau 5", "bouteille eau"] },
      { id: "riz", label: "Riz (sac)", categorie: "alimentaire", mots: ["riz"] },
      { id: "huile", label: "Huile de cuisine", categorie: "alimentaire", mots: ["huile"] },
      { id: "sucre", label: "Sucre", categorie: "alimentaire", mots: ["sucre"] },
      { id: "lait_poudre", label: "Lait en poudre", categorie: "alimentaire", mots: ["lait poudre", "lait en poudre", "nido"] },
      { id: "sardines", label: "Sardines en boîte", categorie: "alimentaire", mots: ["sardine", "boite", "boîte", "conserve"] },
      { id: "pates", label: "Pâtes alimentaires", categorie: "alimentaire", mots: ["pate", "pâte", "spaghetti", "macaroni", "nouille"] },
      { id: "sachets", label: "Sachets plastiques", categorie: "emballages", mots: ["sachet", "emballage", "plastique"] },
      { id: "piles", label: "Piles électriques", categorie: "autre", mots: ["pile"] },
      { id: "allumettes", label: "Allumettes", categorie: "autre", mots: ["allumette", "briquet"] },
      { id: "bougies", label: "Bougies", categorie: "autre", mots: ["bougie"] },
      { id: "cafe", label: "Café soluble", categorie: "alimentaire", mots: ["cafe", "café", "nescafe"] },
      { id: "tomate_concentre", label: "Concentré de tomate", categorie: "alimentaire", mots: ["concentre", "concentré", "tomate"] },
      { id: "maggi", label: "Cubes Maggi", categorie: "alimentaire", mots: ["maggi", "cube", "bouillon"] },
      { id: "papier_hygiénique", label: "Papier hygiénique", categorie: "hygiene", mots: ["papier hygienique", "papier hygiénique", "papier toilette", "pq"] },
      { id: "lait_boite", label: "Lait concentré sucré", categorie: "alimentaire", mots: ["lait concentre", "lait concentré", "lait boite", "lait en boite"] },
      { id: "lessive", label: "Détergent & lessive", categorie: "hygiene", mots: ["lessive", "detergent", "détergent", "omo", "ariel"] },
      { id: "farine", label: "Farine de blé", categorie: "alimentaire", mots: ["farine"] },
      { id: "sel", label: "Sel", categorie: "alimentaire", mots: ["sel"] },
      { id: "salaires", label: "Salaires du personnel", categorie: "personnel", mots: ["salaire", "paye", "vendeur", "vendeuse", "apprenti"] },
      { id: "loyer", label: "Loyer de la boutique", categorie: "charges_fixes", mots: ["loyer", "bail"] },
      { id: "electricite", label: "Électricité (congélateur)", categorie: "charges_fixes", mots: ["electricite", "électricité", "cie", "facture"] },
    ],
  },

  /* ------------------------------------------------ SALON DE COIFFURE & BEAUTÉ */
  salon_beaute: {
    categories: [
      { id: "produits_beaute", label: "Produits de beauté" },
      { id: "consommables", label: "Consommables" },
      { id: "materiel", label: "Matériel" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "faux_ongles", label: "Faux ongles", categorie: "produits_beaute", mots: ["faux ongle", "ongle", "capsule"] },
      { id: "faux_cils", label: "Faux cils", categorie: "produits_beaute", mots: ["faux cil", "cil"] },
      { id: "vernis", label: "Vernis à ongles", categorie: "produits_beaute", mots: ["vernis"] },
      { id: "perruques", label: "Perruques", categorie: "produits_beaute", mots: ["perruque"] },
      { id: "meches", label: "Mèches & tissages", categorie: "produits_beaute", mots: ["meche", "mèche", "tissage", "rattache", "extension"] },
      { id: "dissolvant", label: "Dissolvant", categorie: "consommables", mots: ["dissolvant", "acetone", "acétone"] },
      { id: "gel", label: "Gel coiffant", categorie: "produits_beaute", mots: ["gel", "coiffant"] },
      { id: "defrisant", label: "Défrisant", categorie: "produits_beaute", mots: ["defrisant", "défrisant", "defrisage", "défrisage"] },
      { id: "shampoing", label: "Shampoing", categorie: "produits_beaute", mots: ["shampoing", "shampooing"] },
      { id: "apres_shampoing", label: "Après-shampoing", categorie: "produits_beaute", mots: ["apres shampoing", "après-shampoing", "apres-shampoing", "masque cheveux"] },
      { id: "colorants", label: "Colorants capillaires", categorie: "produits_beaute", mots: ["colorant", "teinture", "coloration"] },
      { id: "huile", label: "Huile capillaire", categorie: "produits_beaute", mots: ["huile", "serum", "sérum"] },
      { id: "gants", label: "Gants jetables", categorie: "consommables", mots: ["gant"] },
      { id: "serviettes", label: "Serviettes", categorie: "consommables", mots: ["serviette", "drap jetable"] },
      { id: "peignes", label: "Peignes & brosses", categorie: "materiel", mots: ["peigne", "brosse"] },
      { id: "rasoirs", label: "Rasoirs & lames", categorie: "consommables", mots: ["rasoir", "lame", "bombe", "tondeuse"] },
      { id: "blanchiment", label: "Produits de blanchiment (crèmes éclaircissantes)", categorie: "produits_beaute", mots: ["blanchiment", "eclaircissant", "éclaircissant", "creme", "crème"] },
      { id: "soin_visage", label: "Crèmes de soin visage", categorie: "produits_beaute", mots: ["soin", "visage", "creme", "crème", "gommage"] },
      { id: "coton", label: "Coton", categorie: "consommables", mots: ["coton", "disque demaquillant", "démaquillant"] },
      { id: "alcool", label: "Alcool à 90°", categorie: "consommables", mots: ["alcool", "90", "desinfectant", "désinfectant"] },
      { id: "colle", label: "Colle à perruque / glue", categorie: "produits_beaute", mots: ["colle", "glue", "adhesif", "adhésif"] },
      { id: "bigoudis", label: "Bigoudis & pinces", categorie: "materiel", mots: ["bigoudi", "pince", "elastique", "élastique", "chouchou"] },
      { id: "salaires", label: "Salaires coiffeurs & apprenties", categorie: "personnel", mots: ["salaire", "paye", "coiffeur", "coiffeuse", "apprentie"] },
      { id: "loyer", label: "Loyer du salon", categorie: "charges_fixes", mots: ["loyer", "bail"] },
      { id: "electricite", label: "Électricité (sèche-cheveux, clim)", categorie: "charges_fixes", mots: ["electricite", "électricité", "facture", "cie"] },
    ],
  },

  /* ---------------------------------------- BOUTIQUE D'ACCESSOIRES DE TÉLÉPHONE */
  accessoires_telephone: {
    categories: [
      { id: "accessoires", label: "Accessoires" },
      { id: "reparation", label: "Réparation & pièces" },
      { id: "emballages", label: "Emballages" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "coques", label: "Coques de téléphone", categorie: "accessoires", mots: ["coque", "housse"] },
      { id: "verre_trempe", label: "Films & verres trempés", categorie: "accessoires", mots: ["verre trempe", "verre trempé", "film", "protection ecran", "protection écran"] },
      { id: "chargeurs", label: "Chargeurs", categorie: "accessoires", mots: ["chargeur"] },
      { id: "cables", label: "Câbles USB / Lightning", categorie: "accessoires", mots: ["cable", "câble", "usb", "lightning", "type c"] },
      { id: "ecouteurs", label: "Écouteurs & oreillettes", categorie: "accessoires", mots: ["ecouteur", "écouteur", "oreillette", "airpod", "casque"] },
      { id: "powerbanks", label: "Batteries externes (power bank)", categorie: "accessoires", mots: ["power bank", "powerbank", "batterie externe", "batterie"] },
      { id: "enceintes", label: "Haut-parleurs Bluetooth", categorie: "accessoires", mots: ["haut-parleur", "enceinte", "bluetooth", "speaker"] },
      { id: "supports", label: "Supports voiture & trépieds", categorie: "accessoires", mots: ["support", "trepied", "trépied"] },
      { id: "cartes_memoire", label: "Cartes mémoire", categorie: "accessoires", mots: ["carte memoire", "carte mémoire", "micro sd", "sd"] },
      { id: "cles_usb", label: "Clés USB", categorie: "accessoires", mots: ["cle usb", "clé usb", "flash"] },
      { id: "adaptateurs", label: "Adaptateurs & chargeurs voiture", categorie: "accessoires", mots: ["adaptateur", "allume-cigare"] },
      { id: "pochettes", label: "Pochettes & housses de transport", categorie: "accessoires", mots: ["pochette", "etui", "étui", "sacoche"] },
      { id: "montres", label: "Montres connectées", categorie: "accessoires", mots: ["montre", "smartwatch", "bracelet"] },
      { id: "occasion", label: "Téléphones d'occasion (achat)", categorie: "reparation", mots: ["occasion", "telephone", "téléphone", "iphone", "samsung", "tecno"] },
      { id: "pieces", label: "Pièces détachées (écrans, batteries)", categorie: "reparation", mots: ["ecran", "écran", "piece", "pièce", "batterie interne", "chassis", "châssis"] },
      { id: "outils", label: "Outils de réparation", categorie: "reparation", mots: ["outil", "tournevis", "spudger", "pince", "fer a souder"] },
      { id: "vente_gros", label: "Écouteurs & câbles achetés en gros", categorie: "accessoires", mots: ["gros", "lot"] },
      { id: "sacs_clients", label: "Sacs & emballages clients", categorie: "emballages", mots: ["sac", "emballage", "sachet"] },
      { id: "salaires", label: "Salaires du réparateur & vendeurs", categorie: "personnel", mots: ["salaire", "paye", "reparateur", "réparateur", "vendeur"] },
      { id: "loyer", label: "Loyer de la boutique", categorie: "charges_fixes", mots: ["loyer", "bail", "etabli", "comptoir"] },
      { id: "electricite", label: "Électricité & climatisation", categorie: "charges_fixes", mots: ["electricite", "électricité", "facture", "clim"] },
    ],
  },

  /* ------------------------------------------------------ BOUTIQUE DE VÊTEMENTS */
  vetements: {
    categories: [
      { id: "vetements", label: "Vêtements" },
      { id: "chaussures", label: "Chaussures & maroquinerie" },
      { id: "accessoires", label: "Accessoires" },
      { id: "emballages", label: "Emballages & présentation" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "tshirts", label: "T-shirts (achat en gros)", categorie: "vetements", mots: ["t-shirt", "tshirt", "tee-shirt", "polo"] },
      { id: "robes", label: "Robes", categorie: "vetements", mots: ["robe"] },
      { id: "pantalons", label: "Pantalons & jeans", categorie: "vetements", mots: ["pantalon", "jean", "jogging", "short"] },
      { id: "chemises", label: "Chemises", categorie: "vetements", mots: ["chemise"] },
      { id: "chaussures_achat", label: "Chaussures", categorie: "chaussures", mots: ["chaussure", "basket", "escarpin", "mocassin"] },
      { id: "sandales", label: "Sandales & tongs", categorie: "chaussures", mots: ["sandale", "tong", "claquette"] },
      { id: "sous_vetements", label: "Sous-vêtements", categorie: "vetements", mots: ["sous-vetement", "sous-vêtement", "slip", "soutien", "caleçon"] },
      { id: "sacs", label: "Sacs & ceintures", categorie: "accessoires", mots: ["sac", "ceinture", "portefeuille", "maroquinerie"] },
      { id: "bijoux", label: "Bijoux fantaisie", categorie: "accessoires", mots: ["bijou", "collier", "boucle", "bague"] },
      { id: "foulards", label: "Foulards & hijabs", categorie: "accessoires", mots: ["foulard", "hijab", "echarpe", "écharpe", "voile"] },
      { id: "pagnes", label: "Pagnes & tissus wax", categorie: "vetements", mots: ["pagne", "wax", "tissu", "bazin"] },
      { id: "enfants", label: "Vêtements pour enfants", categorie: "vetements", mots: ["enfant", "bebe", "bébé", "garcon", "garçon", "fille"] },
      { id: "cintres", label: "Cintres", categorie: "emballages", mots: ["cintre"] },
      { id: "sacs_emballage", label: "Sacs d'emballage & papier cadeau", categorie: "emballages", mots: ["emballage", "sac", "papier cadeau"] },
      { id: "etiquettes", label: "Étiquettes & codes-barres", categorie: "emballages", mots: ["etiquette", "étiquette", "code-barre", "code barre"] },
      { id: "repassage", label: "Repassage & pressing", categorie: "charges_fixes", mots: ["repassage", "fer", "pressing", "nettoyage"] },
      { id: "electricite", label: "Électricité (éclairage, clim)", categorie: "charges_fixes", mots: ["electricite", "électricité", "clim", "facture"] },
      { id: "loyer", label: "Loyer de la boutique", categorie: "charges_fixes", mots: ["loyer", "bail"] },
      { id: "transport", label: "Transport & frais de douane", categorie: "autre", mots: ["transport", "douane", "fret", "import"] },
      { id: "salaires", label: "Salaires des vendeurs", categorie: "personnel", mots: ["salaire", "paye", "vendeur", "vendeuse", "apprenti"] },
      { id: "mannequins", label: "Mannequins & présentoirs", categorie: "emballages", mots: ["mannequin", "presentoir", "présentoir", "etagere", "étagère", "portant"] },
    ],
  },

  /* ------------------------------------------------------------------ PHARMACIE */
  pharmacie: {
    categories: [
      { id: "medicaments", label: "Médicaments" },
      { id: "parapharmacie", label: "Parapharmacie" },
      { id: "materiel_medical", label: "Matériel médical" },
      { id: "personnel", label: "Personnel" },
      { id: "charges_fixes", label: "Charges fixes" },
      { id: "autre", label: "Autre" },
    ],
    postes: [
      { id: "generiques", label: "Médicaments génériques", categorie: "medicaments", mots: ["generique", "générique"] },
      { id: "marque", label: "Médicaments de marque", categorie: "medicaments", mots: ["marque", "princeps"] },
      { id: "antipalu", label: "Antipaludéens", categorie: "medicaments", mots: ["palu", "artemether", "artemisia", "coartem"] },
      { id: "antalgiques", label: "Antalgiques & anti-inflammatoires", categorie: "medicaments", mots: ["douleur", "paracetamol", "ibuprofene", "anti-inflammatoire"] },
      { id: "antibiotiques", label: "Antibiotiques", categorie: "medicaments", mots: ["antibiotique", "amoxicilline", "amoxi"] },
      { id: "sirops", label: "Sirops & pédiatrie", categorie: "medicaments", mots: ["sirop", "pediatrie", "pédiatrie", "enfant"] },
      { id: "desinfectants", label: "Désinfectants", categorie: "parapharmacie", mots: ["desinfectant", "désinfectant", "antiseptique", "dakin"] },
      { id: "pansements", label: "Pansements & compresses", categorie: "parapharmacie", mots: ["pansement", "compresse", "bande", "sparadrap"] },
      { id: "gants", label: "Gants médicaux", categorie: "materiel_medical", mots: ["gant"] },
      { id: "seringues", label: "Seringues & aiguilles", categorie: "materiel_medical", mots: ["seringue", "aiguille", "injectable", "perfusion"] },
      { id: "tests", label: "Tests de diagnostic rapide", categorie: "materiel_medical", mots: ["test", "tdr", "diagnostic"] },
      { id: "preservatifs", label: "Préservatifs & contraceptifs", categorie: "parapharmacie", mots: ["preservatif", "préservatif", "contraceptif", "condom"] },
      { id: "vitamines", label: "Vitamines & compléments", categorie: "parapharmacie", mots: ["vitamine", "complement", "complément", "fer", "acide folique"] },
      { id: "pommades", label: "Crèmes & pommades", categorie: "parapharmacie", mots: ["creme", "crème", "pommade"] },
      { id: "hygiene_intime", label: "Produits d'hygiène intime", categorie: "parapharmacie", mots: ["hygiene intime", "hygiène intime", "serviette hygienique"] },
      { id: "materiel", label: "Matériel médical (tensiomètre…)", categorie: "materiel_medical", mots: ["tensiomètre", "tensiom", "thermomètre", "thermomet", "glucometre", "stethoscope"] },
      { id: "emballages", label: "Emballages & sachets", categorie: "autre", mots: ["emballage", "sachet"] },
      { id: "salaires", label: "Salaires du personnel", categorie: "personnel", mots: ["salaire", "paye", "pharmacien", "vendeur", "preparateur"] },
      { id: "loyer", label: "Loyer de l'officine", categorie: "charges_fixes", mots: ["loyer", "bail", "officine"] },
      { id: "chaine_froid", label: "Électricité (chaîne du froid)", categorie: "charges_fixes", mots: ["electricite", "électricité", "frigo", "chaine du froid", "chaîne du froid"] },
      { id: "gardiennage", label: "Gardiennage de nuit", categorie: "charges_fixes", mots: ["gardien", "gardiennage", "securite", "sécurité"] },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* 3. Accesseurs                                                               */
/* -------------------------------------------------------------------------- */

/** Catégories d'un secteur (fallback : restaurant). */
export function categoriesDuSecteur(secteur) {
  const cle = secteurNormalise(secteur);
  return SECTEURS[cle]?.categories || SECTEURS[SECTEUR_PAR_DEFAUT].categories;
}

/** Les 20+ postes de dépense réels d'un secteur (fallback : restaurant). */
export function postesDuSecteur(secteur) {
  const cle = secteurNormalise(secteur);
  return SECTEURS[cle]?.postes || SECTEURS[SECTEUR_PAR_DEFAUT].postes;
}

/** Libellé lisible d'un poste à partir de son identifiant. */
export function libellePoste(secteur, idPoste) {
  return postesDuSecteur(secteur).find((p) => p.id === idPoste)?.label || "";
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
    if (texte.includes(mot)) {
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
