/** Durée commune à l'affichage, au compte à rebours et aux règles d'accès. */
export const JOURS_ESSAI = 14;
export const JOURS_FONDATEUR = JOURS_ESSAI;

export function dureeEssai(etablissement) {
  const jours = Number(etablissement?.essai_jours);
  // Compatibilité avec les anciennes lignes à 3/7 jours, sans réduire une prolongation.
  return Number.isFinite(jours) ? Math.max(JOURS_ESSAI, jours) : JOURS_ESSAI;
}

export function finEssai(etablissement) {
  if (!etablissement?.date_creation) return null;
  const debut = new Date(etablissement.date_creation).getTime();
  return Number.isFinite(debut)
    ? new Date(debut + dureeEssai(etablissement) * 86400000)
    : null;
}
