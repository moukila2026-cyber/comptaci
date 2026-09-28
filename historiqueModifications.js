/** Un UPDATE n'affiche que les champs réellement modifiés. */
export function champsModifies({ avant, apres, action }) {
  return [...new Set([...Object.keys(avant || {}), ...Object.keys(apres || {})])]
    .filter(champ => action !== "UPDATE" || JSON.stringify(avant?.[champ]) !== JSON.stringify(apres?.[champ]))
    .sort();
}

const MONTANTS = new Set(["montant", "prix_unitaire", "fond_ouverture", "fond_fermeture_reel", "ecart"]);
export function valeurHistorique(valeur, champ, langue, t) {
  if (valeur === null || valeur === undefined || valeur === "") return "—";
  if (typeof valeur === "boolean") return t(valeur ? "audit_oui" : "audit_non");
  if (typeof valeur === "number") {
    return new Intl.NumberFormat(langue, { maximumFractionDigits: 3 }).format(valeur) + (MONTANTS.has(champ) ? " FCFA" : "");
  }
  if (["date", "date_ouverture", "date_fermeture"].includes(champ)) {
    const date = new Date(valeur);
    if (!Number.isNaN(date.getTime())) {
      return champ === "date" ? date.toLocaleDateString(langue, { timeZone: "UTC" }) : date.toLocaleString(langue);
    }
  }
  const cle = `audit_valeur_${valeur}`;
  if (["type", "statut"].includes(champ) && t(cle) !== cle) return t(cle);
  return String(valeur);
}
