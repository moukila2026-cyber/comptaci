/**
 * saspay.js — Paiement par lien SasPay (agrégateur Mobile Money + carte)
 * ---------------------------------------------------------------------------
 * Remplace l'ancien QR code Wave. SasPay fournit un « lien de paiement »
 * réutilisable : le client clique, paie par Wave / Orange Money / MTN MoMo /
 * Moov / carte bancaire, et ComptaCi reçoit la notification.
 *
 * Configuration (variables d'environnement Vite, voir .env.example) :
 *   VITE_SASPAY_PAYMENT_URL   → le lien de paiement SasPay (obligatoire)
 *   VITE_SASPAY_MARCHAND      → nom du marchand affiché (facultatif)
 *   VITE_SASPAY_MODE          → "test" ou "live" (facultatif, défaut "live")
 *
 * Tant que VITE_SASPAY_PAYMENT_URL n'est pas renseigné, l'app affiche un
 * encart « paiement en cours de configuration » + le bouton WhatsApp, au lieu
 * d'un lien cassé.
 */

/** Lien de paiement SasPay (celui créé sur app.saspay.me). */
export const SASPAY_LIEN_PAIEMENT = (
  import.meta.env?.VITE_SASPAY_PAYMENT_URL || ""
).trim();

export const SASPAY_MARCHAND = (
  import.meta.env?.VITE_SASPAY_MARCHAND || "ComptaCi"
).trim();

export const SASPAY_MODE =
  (import.meta.env?.VITE_SASPAY_MODE || "live").trim().toLowerCase() === "test"
    ? "test"
    : "live";

/** Vrai dès qu'un lien SasPay est configuré dans l'environnement. */
export const SASPAY_CONFIGURE = SASPAY_LIEN_PAIEMENT.length > 0;

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

/**
 * Construit le lien de paiement pour un montant / forfait donnés.
 * Les paramètres sont ajoutés en query string : si ton lien SasPay utilise
 * d'autres noms de paramètres, adapte simplement la table ci-dessous.
 *
 * @returns {string|null} `null` si aucun lien n'est configuré.
 */
export function lienPaiementSasPay({
  montant,
  plan = null,
  etablissement = null,
  reference = null,
  telephone = null,
} = {}) {
  if (!SASPAY_CONFIGURE) return null;

  let url;
  try {
    url = new URL(SASPAY_LIEN_PAIEMENT);
  } catch (_) {
    return null;
  }

  const params = [
    ["amount", Math.round(Number(montant) || 0)],
    ["currency", "XOF"],
    ["item", `ComptaCi — ${plan || "abonnement"}`],
    ["reference", reference || refPaiement(etablissement, plan)],
    ["merchant", SASPAY_MARCHAND],
    ["mode", SASPAY_MODE],
  ];

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
 */
export function refPaiement(etablissement, plan) {
  const id = String(etablissement?.id || "XXXXXX").replace(/-/g, "").slice(0, 6).toUpperCase();
  const now = new Date();
  const periode = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `CCI-${id}-${periode}-${plan || "abo"}`;
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
