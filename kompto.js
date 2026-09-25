/**
 * kompto.js — Client KOMPTO pour la Facture Normalisée Électronique (FNE)
 * --------------------------------------------------------------------------
 * Intégration fidèle au guide officiel **KOMPTO API GUIDE EN v5.2**
 * et à la collection Postman « KOMPTO API — Sandbox ».
 *
 * Points d'attention couverts :
 *  - BaseUrl / apiKey / establishment / pointOfSale configurables
 *  - Auth Bearer sur chaque requête, 401 = clé invalide (problem+json)
 *  - Path A (verify → confirm) recommandé, Path B (create) dispo
 *  - Chaining de variables (komptoEntryId, komptoItemId, confirmedEntryId…)
 *  - Montants envoyés en number, reçus en string ; décimale dot → comma
 *  - Pourcentages avec % côté réponse, nombre nu côté requête
 *  - Taxes optionnelles = null/omitted, jamais 0, par paires
 *  - establishment/pointOfSale case-sensitive
 *  - Erreurs 200+isSuccessful:false, 400 errors, 404 bare string
 *  - getVerify enveloppe {value}, getElectronicInvoice plat
 *  - dateTimeFNE = YYYY-MM-DD HH:mm (heure CI, sans fuseau)
 *  - Credit note uniquement en quantité, prix hérité
 *  - DELETE ne marche qu'en brouillon
 */

/* ------------------------------------------------------------------ */
/* 1. Configuration & constantes                                       */
/* ------------------------------------------------------------------ */

export const KOMPTO_SANDBOX_HOST = "https://qa.kompto.com";
export const KOMPTO_API_BASE = (
  import.meta.env?.VITE_KOMPTO_API_URL ||
  import.meta.env?.VITE_FNE_API_URL ||
  KOMPTO_SANDBOX_HOST
).replace(/\/+$/, "");

export const KOMPTO_VERIF_BASE =
  import.meta.env?.VITE_KOMPTO_VERIF_URL ||
  import.meta.env?.VITE_FNE_VERIF_URL ||
  "https://fne.dgi.gouv.ci/verification";

export const KOMPTO_DEFAULTS = {
  baseUrl: KOMPTO_SANDBOX_HOST,
  establishment: "PROGICI SARL",
  pointOfSale: "SIEGE",
  paymentMethod: "transfer",
  clientName: "KOUAME ET FRERES SARL",
  clientNCC: "8200001A",
  clientTelephone: "2721212121",
  clientEmail: "contact@kouame-freres.ci",
};

export const KOMPTO_PAYMENT_METHODS = [
  "cash",
  "card",
  "check",
  "mobile-money",
  "transfer",
  "deferred",
];

export const KOMPTO_CLIENT_TYPES = ["B2B", "B2G", "B2C", "B2F"];

export const KOMPTO_TVA = {
  TVA: "18%",
  TVAB: "9%",
  TVAC: "0%",
  TVAD: "0%",
  TVAE: "0%",
};

export const KOMPTO_TVA_CODES = Object.keys(KOMPTO_TVA);

/* ------------------------------------------------------------------ */
/* 2. Helpers de parsing (réponses → nombres)                          */
/* ------------------------------------------------------------------ */

/**
 * Décode un montant renvoyé par KOMPTO : string avec virgule française.
 * Exemples : "50000" → 50000, "655,9570" → 655.957, "590 000" → 590000
 */
export function parseMontantKompto(val) {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).trim();
  if (!s) return 0;
  // retire espaces insécables, espaces, puis virgule → dot
  const normal = s.replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(normal);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Décode un pourcentage renvoyé par KOMPTO : "18%" → 18, "2,50%" → 2.5
 */
export function parsePourcentKompto(val) {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).trim().replace("%", "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Totaux d'une facture KOMPTO décodés en nombres (utile pour l'affichage ERP).
 */
export function totauxDecodes(invoice) {
  if (!invoice) return null;
  return {
    entryTotalPriceHT: parseMontantKompto(invoice.entryTotalPriceHT),
    entryTotalPriceDiscountedHT: parseMontantKompto(invoice.entryTotalPriceDiscountedHT),
    entryTotalTVA: parseMontantKompto(invoice.entryTotalTVA),
    entryTotalTaxesTTC: parseMontantKompto(invoice.entryTotalTaxesTTC),
    entryTotalPriceTTC: parseMontantKompto(invoice.entryTotalPriceTTC),
    entryTotalDue: parseMontantKompto(invoice.entryTotalDue),
    entryTimbre: parseMontantKompto(invoice.entryTimbre),
    entryTotalDueFX: invoice.entryTotalDueFX != null ? parseMontantKompto(invoice.entryTotalDueFX) : null,
    exchangeRate: invoice.exchangeRateCFAtoFX != null ? parseMontantKompto(invoice.exchangeRateCFAtoFX) : null,
  };
}

/**
 * Déballe l'enveloppe {value} de GET /getVerify.
 * Les autres endpoints renvoient l'objet plat.
 */
export function unwrapKompto(body) {
  if (!body) return null;
  if (typeof body === "string") return body; // 404 bare string
  if (body.value && typeof body.value === "object" && body.value.komptoEntryId != null) return body.value;
  return body;
}

/**
 * Détecte une erreur métier malgré HTTP 200.
 */
export function estEchecMetier(body) {
  return body && typeof body === "object" && body.isSuccessful === false;
}

/**
 * Formatte un montant en FCFA lisible.
 */
export const fmtFCFA = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));

/* ------------------------------------------------------------------ */
/* 3. Validation côté client (messages alignés sur la doc KOMPTO)      */
/* ------------------------------------------------------------------ */

export function isValidNCC(ncc) {
  return /^[0-9]{7}[A-Z]$/.test(String(ncc || "").trim());
}

export function isValidTelephoneB2x(tel) {
  // 10 chiffres commençant par 01,05,07,21,25,27
  return /^(01|05|07|21|25|27)[0-9]{8}$/.test(String(tel || "").trim().replace(/\s/g, ""));
}

export function isValidTelephoneB2F(tel) {
  const t = String(tel || "").trim();
  return /^(\+|00)[0-9]+$/.test(t) && !/\s|-|\(|\)/.test(t);
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

/* ------------------------------------------------------------------ */
/* 4. Helpers d'état d'enrôlement Kompto                               */
/* ------------------------------------------------------------------ */

/**
 * @param {object} etablissement - ligne etablissements (Supabase)
 * @returns {{ pretPourApi: boolean, manque: string[], mode: string, config: object }}
 */
export function etatKompto(etablissement) {
  const cfg = configKompto(etablissement);
  const manque = [];
  if (!cfg.apiKey) manque.push("apiKey");
  if (!cfg.establishment) manque.push("establishment");
  if (!cfg.pointOfSale) manque.push("pointOfSale");
  if (!cfg.baseUrl) manque.push("baseUrl");
  const pretPourApi = manque.length === 0;
  return {
    pretPourApi,
    manque,
    // prêt → certifié (via KOMPTO/DGI), sinon brouillon
    mode: pretPourApi ? "certifie" : "brouillon",
    config: cfg,
  };
}

export function configKompto(etablissement) {
  // Priorité aux colonnes kompto_*, sinon fallback fne_cle_api / défauts
  const rawApiKey =
    etablissement?.kompto_api_key ||
    etablissement?.kompto_cle_api ||
    etablissement?.fne_cle_api ||
    import.meta.env?.VITE_KOMPTO_API_KEY ||
    "";
  const rawBase =
    etablissement?.kompto_base_url ||
    import.meta.env?.VITE_KOMPTO_API_URL ||
    KOMPTO_API_BASE;
  return {
    apiKey: String(rawApiKey || "").trim(),
    baseUrl: String(rawBase || KOMPTO_SANDBOX_HOST).replace(/\/+$/, ""),
    establishment: String(
      etablissement?.kompto_etablissement ||
        etablissement?.kompto_establishment ||
        etablissement?.fne_etablissement ||
        KOMPTO_DEFAULTS.establishment
    ).trim(),
    pointOfSale: String(
      etablissement?.kompto_point_de_vente ||
        etablissement?.kompto_pointofSale ||
        etablissement?.fne_point_de_vente ||
        KOMPTO_DEFAULTS.pointOfSale
    ).trim(),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Construction des payloads                                        */
/* ------------------------------------------------------------------ */

/**
 * Normalise une paire de taxe : les deux ou rien, jamais 0.
 * Retourne { name, percent } ou { name:null, percent:null }
 */
function normalisePaireTaxe(name, percent) {
  const n = name != null ? String(name).trim() : "";
  const p = percent;
  const hasName = Boolean(n);
  const hasPercent = p !== null && p !== undefined && String(p).trim() !== "";
  // une seule moitié → on neutralise (l'API renverra 400, on préfère être explicite)
  if (hasName !== hasPercent) return { name: n || null, percent: hasPercent ? Number(p) : null, invalide: true };
  if (!hasName) return { name: null, percent: null, invalide: false };
  const num = Number(p);
  if (!Number.isFinite(num) || num === 0) return { name: n, percent: num, invalide: true }; // 0 interdit
  return { name: n, percent: num, invalide: false };
}

/**
 * Construit le body de POST /verify à partir de champs ergonomiques.
 * Les montants doivent rester des numbers (pas des strings).
 */
export function buildVerifyPayload({
  clientType = "B2B",
  clientName,
  clientNCC = null,
  clientTelephone,
  clientEmail,
  foreignCurrencyName = null,
  exchangeRateCFAtoFX = null,
  entryTaxTTC1Name = null,
  entryTaxTTC1Percent = null,
  entryTaxTTC2Name = null,
  entryTaxTTC2Percent = null,
  items = [],
}) {
  const entryTax1 = normalisePaireTaxe(entryTaxTTC1Name, entryTaxTTC1Percent);
  const entryTax2 = normalisePaireTaxe(entryTaxTTC2Name, entryTaxTTC2Percent);

  const cleanItems = items.map((it) => {
    const t1 = normalisePaireTaxe(it.itemTaxTTC1Name, it.itemTaxTTC1Percent);
    const t2 = normalisePaireTaxe(it.itemTaxTTC2Name, it.itemTaxTTC2Percent);
    return {
      itemName: String(it.itemName || "").trim(),
      itemReference: it.itemReference != null ? String(it.itemReference).trim() || null : null,
      itemUnitOfMeasure: it.itemUnitOfMeasure != null ? String(it.itemUnitOfMeasure).trim() || null : null,
      itemQuantity: Number(it.itemQuantity),
      itemUnitPrice: Number(it.itemUnitPrice),
      itemDiscountPercent: it.itemDiscountPercent != null && it.itemDiscountPercent !== "" ? Number(it.itemDiscountPercent) : null,
      itemTVAName: String(it.itemTVAName || "TVA").trim(),
      itemTaxTTC1Name: t1.name,
      itemTaxTTC1Percent: t1.percent,
      itemTaxTTC2Name: t2.name,
      itemTaxTTC2Percent: t2.percent,
    };
  });

  return {
    clientType,
    clientName: String(clientName || "").trim(),
    clientNCC: clientNCC != null ? String(clientNCC).trim() || null : null,
    clientTelephone: String(clientTelephone || "").trim(),
    clientEmail: String(clientEmail || "").trim(),
    foreignCurrencyName: foreignCurrencyName != null ? String(foreignCurrencyName).trim() || null : null,
    exchangeRateCFAtoFX: exchangeRateCFAtoFX != null && exchangeRateCFAtoFX !== "" ? Number(exchangeRateCFAtoFX) : null,
    entryTaxTTC1Name: entryTax1.name,
    entryTaxTTC1Percent: entryTax1.percent,
    entryTaxTTC2Name: entryTax2.name,
    entryTaxTTC2Percent: entryTax2.percent,
    items: cleanItems,
  };
}

export function buildConfirmPayload({
  komptoEntryId,
  establishment,
  pointOfSale,
  paymentMethod = "transfer",
  isRNE = false,
  numberRNE = null,
  otherInfo = null,
  footer = null,
}) {
  return {
    komptoEntryId: Number(komptoEntryId),
    establishment: String(establishment || "").trim(),
    pointOfSale: String(pointOfSale || "").trim(),
    paymentMethod: String(paymentMethod || "").trim().toLowerCase(),
    isRNE: Boolean(isRNE),
    numberRNE: isRNE ? String(numberRNE || "").trim() || null : null,
    otherInfo: otherInfo != null ? String(otherInfo).trim().slice(0, 250) || null : null,
    footer: footer != null ? String(footer).trim().slice(0, 250) || null : null,
  };
}

export function buildCreatePayload(verifyFields, confirmFields) {
  return {
    ...buildVerifyPayload(verifyFields),
    ...buildConfirmPayload(confirmFields),
  };
}

/**
 * Fabrique un payload verify minimal depuis une vente ComptaCi.
 * TVA par défaut 18% (TVA). Le client peut être surchargé.
 */
export function payloadDepuisVente({ vente, etablissement, clientOverrides = {}, itemsOverride = null }) {
  const quantite = Number(vente?.quantite) || Number(vente?.quantity) || 1;
  const prixUnitaire = Number(vente?.prixUnitaire) || Number(vente?.montant) || 0;
  const designation = vente?.designation || vente?.note?.split("—")[0]?.trim() || "Vente";
  const tva = KOMPTO_TVA_CODES.includes(vente?.tva) ? vente.tva : "TVA";

  const items = itemsOverride || [
    {
      itemName: designation,
      itemReference: null,
      itemUnitOfMeasure: "Unit",
      itemQuantity: quantite,
      itemUnitPrice: prixUnitaire,
      itemDiscountPercent: null,
      itemTVAName: tva,
      itemTaxTTC1Name: null,
      itemTaxTTC1Percent: null,
      itemTaxTTC2Name: null,
      itemTaxTTC2Percent: null,
    },
  ];

  return buildVerifyPayload({
    clientType: clientOverrides.clientType || "B2B",
    clientName: clientOverrides.clientName || KOMPTO_DEFAULTS.clientName,
    clientNCC: clientOverrides.clientNCC ?? KOMPTO_DEFAULTS.clientNCC,
    clientTelephone: clientOverrides.clientTelephone || KOMPTO_DEFAULTS.clientTelephone,
    clientEmail: clientOverrides.clientEmail || KOMPTO_DEFAULTS.clientEmail,
    foreignCurrencyName: clientOverrides.foreignCurrencyName ?? null,
    exchangeRateCFAtoFX: clientOverrides.exchangeRateCFAtoFX ?? null,
    entryTaxTTC1Name: null,
    entryTaxTTC1Percent: null,
    entryTaxTTC2Name: null,
    entryTaxTTC2Percent: null,
    items,
  });
}

/* ------------------------------------------------------------------ */
/* 6. Cœur HTTP                                                        */
/* ------------------------------------------------------------------ */

function headersKompto(apiKey) {
  const h = { Accept: "application/json" };
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  return h;
}

async function komptoFetch({ baseUrl, apiKey, method, path, query = null, body = null }) {
  const cleanBase = String(baseUrl || KOMPTO_SANDBOX_HOST).replace(/\/+$/, "");
  const url = new URL(cleanBase + path);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    });
  }
  const opts = {
    method,
    headers: { ...headersKompto(apiKey) },
  };
  if (body != null) {
    opts.headers["Content-Type"] = "application/json; charset=utf-8";
    opts.body = JSON.stringify(body);
  }
  let status = 0;
  let rawText = "";
  let parsed = null;
  let responseHeaders = null;
  try {
    const res = await fetch(url.toString(), opts);
    status = res.status;
    responseHeaders = res.headers;
    rawText = await res.text();
    if (rawText) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // si ce n'est pas du JSON, on garde le texte brut (ex: paymentMethod est invalide;)
        parsed = rawText;
      }
    }
    return {
      ok: res.ok,
      status,
      headers: responseHeaders,
      raw: rawText,
      body: parsed,
      url: url.toString(),
    };
  } catch (e) {
    return {
      ok: false,
      status: status || 0,
      headers: responseHeaders,
      raw: String(e?.message || e),
      body: null,
      url: url.toString(),
      networkError: String(e?.message || e),
    };
  }
}

/* ------------------------------------------------------------------ */
/* 7. Parsing d'erreur (3 formes)                                      */
/* ------------------------------------------------------------------ */

export function parseKomptoError(result) {
  const { status, body, raw } = result || {};
  if (!result) return { status: 0, message: "Réponse vide du serveur.", details: null, raw: "" };

  // 401 problem+json
  if (status === 401) {
    const detail = body?.detail || body?.title || raw;
    return {
      status: 401,
      message: detail || "Clé API invalide. Vérifiez l'en-tête Authorization: Bearer <clé>.",
      details: body,
      raw,
      kind: "auth",
    };
  }

  // 404 bare string
  if (status === 404) {
    const msg = typeof body === "string" ? body : body?.message || raw;
    // la getter 404 renvoie littéralement "\"La commande n'existe pas.\""
    const clean = typeof msg === "string" ? msg.replace(/^"|"$/g, "") : String(msg);
    return {
      status: 404,
      message: clean || "La commande n'existe pas.",
      details: body,
      raw,
      kind: "not_found",
    };
  }

  // 400 validation ASP.NET : { errors: { Field: [msg] } }
  if (body && typeof body === "object" && body.errors && typeof body.errors === "object") {
    const champs = Object.entries(body.errors)
      .map(([field, msgs]) => `${field} → ${(Array.isArray(msgs) ? msgs : [msgs]).join(" | ")}`)
      .join(" ; ");
    return {
      status: status || 400,
      message: champs || body.title || "Erreur de validation.",
      details: body.errors,
      raw,
      kind: "validation",
    };
  }

  // { isSuccessful:false, message: "..." } — peut être en 200 ou 400
  if (body && typeof body === "object" && body.isSuccessful === false) {
    return {
      status,
      message: body.message || "La DGI a rejeté la facture.",
      details: body,
      raw,
      kind: "business",
    };
  }

  // Cas texte brut (ex: "paymentMethod est invalide;")
  if (typeof body === "string" && body.trim()) {
    return { status, message: body.trim(), details: null, raw, kind: "raw" };
  }

  if (body && typeof body === "object" && body.message) {
    return { status, message: body.message, details: body, raw, kind: "message" };
  }

  if (status >= 400) {
    return { status, message: raw?.slice(0, 500) || `Erreur HTTP ${status}`, details: body, raw, kind: "http" };
  }

  return { status, message: "", details: body, raw, kind: "ok" };
}

/**
 * Extrait le message utilisateur d'une erreur KOMPTO (toujours en français).
 */
export function messageErreurKompto(result) {
  return parseKomptoError(result).message || "Une erreur est survenue.";
}

/* ------------------------------------------------------------------ */
/* 8. Endpoints                                                         */
/* ------------------------------------------------------------------ */

/**
 * Smoke test : /getVerify?komptoEntryId=0 — 401 si clé mauvaise, 404 si clé OK.
 */
export async function checkApiKey({ baseUrl = KOMPTO_API_BASE, apiKey }) {
  return await komptoFetch({ baseUrl, apiKey, method: "GET", path: "/api/invoice/getVerify", query: { komptoEntryId: 0 } });
}

/** POST /api/invoice/verify */
export async function verifyInvoice(payload, { baseUrl = KOMPTO_API_BASE, apiKey }) {
  const res = await komptoFetch({ baseUrl, apiKey, method: "POST", path: "/api/invoice/verify", body: payload });
  const invoice = unwrapKompto(res.body);
  const isOk = res.status === 200 && !estEchecMetier(res.body) && invoice?.komptoEntryId != null;
  return { ...res, invoice, isOk, error: isOk ? null : parseKomptoError(res) };
}

/** POST /api/invoice/confirm */
export async function confirmInvoice(payload, { baseUrl = KOMPTO_API_BASE, apiKey }) {
  const res = await komptoFetch({ baseUrl, apiKey, method: "POST", path: "/api/invoice/confirm", body: payload });
  const invoice = unwrapKompto(res.body);
  const isOk = res.status === 200 && !estEchecMetier(res.body) && invoice?.numberFNE != null;
  return { ...res, invoice, isOk, error: isOk ? null : parseKomptoError(res) };
}

/** POST /api/invoice/create (verify+confirm) */
export async function createInvoice(payload, { baseUrl = KOMPTO_API_BASE, apiKey }) {
  const res = await komptoFetch({ baseUrl, apiKey, method: "POST", path: "/api/invoice/create", body: payload });
  const invoice = unwrapKompto(res.body);
  const isOk = res.status === 200 && !estEchecMetier(res.body) && invoice?.numberFNE != null;
  return { ...res, invoice, isOk, error: isOk ? null : parseKomptoError(res) };
}

/** GET /api/invoice/getVerify?komptoEntryId= */
export async function getVerify(komptoEntryId, { baseUrl = KOMPTO_API_BASE, apiKey }) {
  const res = await komptoFetch({ baseUrl, apiKey, method: "GET", path: "/api/invoice/getVerify", query: { komptoEntryId } });
  const invoice = unwrapKompto(res.body);
  const isOk = res.status === 200 && invoice?.komptoEntryId != null;
  return { ...res, invoice, isOk, error: isOk ? null : parseKomptoError(res) };
}

/** GET /api/invoice/getElectronicInvoice?komptoEntryId= */
export async function getElectronicInvoice(komptoEntryId, { baseUrl = KOMPTO_API_BASE, apiKey }) {
  const res = await komptoFetch({ baseUrl, apiKey, method: "GET", path: "/api/invoice/getElectronicInvoice", query: { komptoEntryId } });
  const invoice = unwrapKompto(res.body);
  // confirmé = numberFNE présent
  const isOk = res.status === 200 && invoice?.numberFNE != null;
  return { ...res, invoice, isOk, error: isOk ? null : parseKomptoError(res) };
}

/** POST /api/invoice/createCreditNote */
export async function createCreditNote({ komptoEntryId, items }, { baseUrl = KOMPTO_API_BASE, apiKey }) {
  const payload = {
    komptoEntryId: Number(komptoEntryId),
    items: (items || []).map((it) => ({
      komptoItemId: Number(it.komptoItemId),
      itemQuantity: Number(it.itemQuantity),
    })),
  };
  const res = await komptoFetch({ baseUrl, apiKey, method: "POST", path: "/api/invoice/createCreditNote", body: payload });
  const note = unwrapKompto(res.body);
  const isOk = res.status === 200 && !estEchecMetier(res.body) && note?.numberFNE != null;
  return { ...res, invoice: note, isOk, error: isOk ? null : parseKomptoError(res) };
}

/** DELETE /api/invoice/delete?komptoEntryId= */
export async function deleteDraft(komptoEntryId, { baseUrl = KOMPTO_API_BASE, apiKey }) {
  const res = await komptoFetch({ baseUrl, apiKey, method: "DELETE", path: "/api/invoice/delete", query: { komptoEntryId } });
  const ok = res.status === 200 && res.body?.isSuccessful === true;
  return { ...res, isOk: ok, error: ok ? null : parseKomptoError(res) };
}

/* ------------------------------------------------------------------ */
/* 9. Compat DGI / affichage                                           */
/* ------------------------------------------------------------------ */

/**
 * URL publique de vérification DGI (linkFNE déjà fourni, sinon fallback).
 */
export function lienVerificationKompto(invoice) {
  if (!invoice) return null;
  if (invoice.linkFNE) return invoice.linkFNE;
  if (invoice.numberFNE) return `${KOMPTO_VERIF_BASE.replace(/\/+$/, "")}?numero=${encodeURIComponent(invoice.numberFNE)}`;
  return null;
}

export function urlQrKompto(invoiceOrNumber) {
  const numero = typeof invoiceOrNumber === "string" ? invoiceOrNumber : invoiceOrNumber?.numberFNE;
  const lien = typeof invoiceOrNumber === "string" ? `${KOMPTO_VERIF_BASE}?numero=${encodeURIComponent(numero)}` : lienVerificationKompto(invoiceOrNumber);
  if (!lien) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(lien)}`;
}

/**
 * dateTimeFNE "YYYY-MM-DD HH:mm" → Date (heure CI, sans fuseau)
 */
export function parseDateTimeFNE(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

/**
 * Numéro FNE officiel : 19 caractères. Crédit = A + 8 NCC + 2 an + 8 séquence.
 */
export function isCreditNote(invoice) {
  return String(invoice?.typeFNE || "").toLowerCase() === "credit note";
}

/**
 * Calcule le montant TTC d'un avoir pro rata (formule doc).
 * Utile côté ERP pour prévisualiser ; le serveur reste l'arbitre.
 */
export function apercuAvoir({ itemOrigine, quantiteRetour }) {
  const q = Number(quantiteRetour);
  const pu = Number(itemOrigine.itemUnitPrice || itemOrigine.prixUnitaire || 0);
  const remise = Number(itemOrigine.itemDiscountPercent || 0) / 100;
  const ht = pu * q;
  const htRemise = ht * (1 - remise);
  // TVA et taxes : on applique les taux de la ligne d'origine
  const tvaTaux = parsePourcentKompto(itemOrigine.itemTVAPercent || itemOrigine.tva || "18%") / 100;
  return {
    ht,
    htRemise,
    tva: htRemise * tvaTaux,
  };
}

/* ------------------------------------------------------------------ */
/* 10. Variable chaining (mirroir Postman)                             */
/* ------------------------------------------------------------------ */

export function chainFromVerify(invoice) {
  return {
    komptoEntryId: invoice?.komptoEntryId ?? "",
    komptoItemId: invoice?.items?.[0]?.komptoItemId ?? "",
    allItemIds: (invoice?.items || []).map((i) => i.komptoItemId).filter(Boolean),
  };
}

export function chainFromConfirm(invoice) {
  return {
    confirmedEntryId: invoice?.komptoEntryId ?? "",
    creditNoteItemId: invoice?.items?.[0]?.komptoItemId ?? "",
    numberFNE: invoice?.numberFNE ?? "",
    linkFNE: invoice?.linkFNE ?? "",
    allItemIds: (invoice?.items || []).map((i) => i.komptoItemId).filter(Boolean),
  };
}

/* ------------------------------------------------------------------ */
/* 11. Erreur réseau / affichage utilisateur                           */
/* ------------------------------------------------------------------ */

export function getKomptoErrorShape(body) {
  if (body == null) return "empty";
  if (typeof body === "string") return "bare_string";
  if (body.errors) return "validation_errors";
  if (body.isSuccessful === false) return "business_envelope";
  if (body.value) return "wrapped_value";
  return "flat_invoice";
}
