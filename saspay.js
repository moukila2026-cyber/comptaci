/**
 * saspay.js — Paiement par lien SasPay (agrégateur Mobile Money + carte)
 * ---------------------------------------------------------------------------
 * Remplace l'ancien QR code Wave. SasPay fournit un « lien de paiement »
 * réutilisable par forfait : le client clique, paie par Wave / Orange Money /
 * MTN MoMo / Moov / carte bancaire, et SasPay notifie ComptaCi via le webhook
 * `supabase/functions/webhook-saspay` (activation automatique de l'abonnement).
 *
 * LIENS DE PAIEMENT COMPTACI (créés sur app.saspay.me) :
 *   Starter    → https://link.saspay.me/vmtjcwrgafk
 *   Pro        → https://link.saspay.me/vrgqoaut3ba
 *   Entreprise → https://link.saspay.me/zszja0kudmy
 *
 * Ils sont déjà écrits ci-dessous (aucune configuration requise) et peuvent
 * être surchargés par les variables d'environnement :
 *   VITE_SASPAY_URL_STARTER / VITE_SASPAY_URL_PRO / VITE_SASPAY_URL_ENTREPRISE
 *   VITE_SASPAY_PAYMENT_URL  → lien générique de secours (toutes formules)
 *   VITE_SASPAY_MARCHAND     → nom du marchand affiché
 *   VITE_SASPAY_MODE         → "test" ou "live" (défaut "live")
 */

/** Liens de paiement par forfait (valeurs par défaut = liens ComptaCi). */
export const LIENS_PAIEMENT = {
  starter: (
    import.meta.env?.VITE_SASPAY_URL_STARTER || "https://link.saspay.me/vmtjcwrgafk"
  ).trim(),
  pro: (
    import.meta.env?.VITE_SASPAY_URL_PRO || "https://link.saspay.me/vrgqoaut3ba"
  ).trim(),
  entreprise: (
    import.meta.env?.VITE_SASPAY_URL_ENTREPRISE ||
    "https://link.saspay.me/zszja0kudmy"
  ).trim(),
};

/** Lien générique de secours (si un forfait n'a pas de lien dédié). */
export const SASPAY_LIEN_GENERIQUE = (
  import.meta.env?.VITE_SASPAY_PAYMENT_URL || ""
).trim();

export const SASPAY_MARCHAND = (
  import.meta.env?.VITE_SASPAY_MARCHAND || "ComptaCi"
).trim();

export const SASPAY_MODE =
  (import.meta.env?.VITE_SASPAY_MODE || "live").trim().toLowerCase() === "test"
    ? "test"
    : "live";

/** Vrai dès qu'au moins un lien SasPay est disponible. */
export const SASPAY_CONFIGURE =
  Object.values(LIENS_PAIEMENT).some((l) => l.length > 0) ||
  SASPAY_LIEN_GENERIQUE.length > 0;

/** Méthodes de paiement acceptées par SasPay en Afrique de l'Ouest. */
export const SASPAY_MOYENS = [
  "Wave",
  "Orange Money",
  "MTN MoMo",
  "Moov Money",
  "Carte bancaire",
];

/** Numéro WhatsApp du support ComptaCi (secours si le lien échoue). */
export const WHATSAPP_SUPPORT = "2250501303343";

/** forfait → lien SasPay dédié (secours : le lien générique). */
export function lienDuPlan(plan) {
  return LIENS_PAIEMENT[plan] || SASPAY_LIEN_GENERIQUE || "";
}

/** Le forfait dispose-t-il d'un lien de paiement ? */
export function lienPlanConfigure(plan) {
  return lienDuPlan(plan).length > 0;
}

/**
 * Construit le lien de paiement pour un montant / forfait donnés.
 *
 * Avec un **lien dédié au forfait**, le montant est déjà fixé par SasPay :
 * on n'ajoute donc que les paramètres de suivi (référence, établissement,
 * téléphone), jamais le montant. Avec le **lien générique** de secours, on
 * ajoute amount / currency / item comme avant.
 *
 * @returns {string|null} `null` si aucun lien n'est disponible.
 */
export function lienPaiementSasPay({
  montant,
  plan = null,
  etablissement = null,
  reference = null,
  telephone = null,
} = {}) {
  const base = lienDuPlan(plan);
  if (!base) return null;

  let url;
  try {
    url = new URL(base);
  } catch (_) {
    // Lien non analysable : on le renvoie tel quel plutôt que de casser le paiement.
    return base;
  }

  const lienDedie = Boolean(LIENS_PAIEMENT[plan]);

  const params = [["reference", reference || refPaiement(etablissement, plan)]];

  if (!lienDedie) {
    params.push(
      ["amount", Math.round(Number(montant) || 0)],
      ["currency", "XOF"],
      ["item", `ComptaCi — ${plan || "abonnement"}`],
      ["merchant", SASPAY_MARCHAND],
      ["mode", SASPAY_MODE]
    );
  }

  if (etablissement?.nom) params.push(["business", etablissement.nom]);
  if (etablissement?.id) params.push(["business_id", String(etablissement.id)]);
  if (telephone) params.push(["phone", telephone]);

  params.forEach(([cle, valeur]) => {
    if (valeur !== null && valeur !== undefined && valeur !== "") {
      url.searchParams.set(cle, String(valeur));
    }
  });

  return url.toString();
}

/**
 * Référence de paiement lisible et stable :
 * ex. « CCI-AB12CD-202609-starter »
 * Le dernier segment (le forfait) est relu par le webhook SasPay.
 */
export function refPaiement(etablissement, plan) {
  const id = String(etablissement?.id || "XXXXXX")
    .replace(/-/g, "")
    .slice(0, 6)
    .toUpperCase();
  const now = new Date();
  const periode = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `CCI-${id}-${periode}-${plan || "abo"}`;
}

/** Relit le forfait porté par une référence « CCI-XXXXXX-AAAAMM-pro ». */
export function planDeReference(reference) {
  const parties = String(reference || "").split("-");
  const dernier = (parties[parties.length - 1] || "").toLowerCase();
  return ["starter", "pro", "entreprise"].includes(dernier) ? dernier : null;
}

/**
 * Ouvre le paiement SasPay dans un nouvel onglet.
 * @returns {boolean} vrai si le lien a été ouvert.
 */
export function ouvrirPaiementSasPay(options) {
  const url = lienPaiementSasPay(options);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
