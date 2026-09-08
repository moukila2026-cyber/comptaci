/**
 * Palette JavaScript de l'application (thème sombre).
 *
 * Elle est le miroir exact des variables CSS définies dans `ui.css`
 * (`:root { --cc-* }`). Les styles inline et les graphiques SVG (Recharts)
 * n'acceptent pas toujours `var(--…)` : ce module fournit donc les mêmes
 * couleurs sous forme de constantes JS.
 *
 * ⚠️ Garder ce fichier et le bloc `:root` de `ui.css` synchronisés.
 */

export const C = {
  /* Fonds */
  bg: "#0B1120",
  surface: "#151E31",
  surface2: "#1A2438",
  surface3: "#22304B",
  surfaceInverse: "#E9EEFA",

  /* Bordures */
  bord: "#26324C",
  bordFort: "#35435F",

  /* Textes */
  texte: "#E9EEFA",
  texteCorps: "#B8C2D8",
  texteDoux: "#94A0BC",
  texteDiscret: "#6B7896",
  texteInverse: "#0B1120",

  /* Or */
  or: "#E8B65A",
  orClair: "#F3D9A0",
  orPale: "#F7E6C2",

  /* Surfaces bleu nuit en relief (boutons secondaires) */
  accent: "#22314F",

  /* États */
  vert: "#43C79A",
  vertFond: "rgba(67,199,154,0.14)",
  vertBord: "rgba(67,199,154,0.36)",
  rouge: "#F08060",
  rougeFond: "rgba(240,128,96,0.14)",
  rougeBord: "rgba(240,128,96,0.36)",

  /* Or — fonds et bordures translucides */
  orFond: "rgba(232,182,90,0.13)",
  orBord: "rgba(232,182,90,0.34)",

  /* Graphiques */
  bleu: "#5AA9E6",
  violet: "#8B7BC7",
  sable: "#C9A063",
  grille: "#26324C",
};

/** Couleurs des barres / secteurs de la répartition des dépenses. */
export const COULEURS_GRAPH = [
  "#E8B65A",
  "#5AA9E6",
  "#43C79A",
  "#8B7BC7",
  "#F08060",
  "#C9A063",
  "#7C8CA8",
  "#3FBF8F",
];

/** Couleurs historiques conservées pour compatibilité (nuances or/terre). */
export const COULEURS_REPARTITION = COULEURS_GRAPH;

/** Voile sombre posé sur les photos de bandeau des pages. */
export const VOILE_BANNIERE =
  "linear-gradient(90deg, rgba(6,11,22,0.92) 0%, rgba(6,11,22,0.55) 55%, rgba(6,11,22,0.12) 100%)";

/** Ombre portée utilisable dans les styles inline. */
export const OMBRE = "0 1px 2px rgba(0,0,0,0.28), 0 10px 26px -14px rgba(0,0,0,0.65)";
export const OMBRE_FORTE = "0 18px 44px -18px rgba(0,0,0,0.8)";
export const OMBRE_OR = "0 8px 26px -12px rgba(232,182,90,0.45)";
