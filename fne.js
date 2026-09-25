/**
 * fne.js — Facture Normalisée Électronique (FNE / DGI Côte d'Ivoire) via KOMPTO
 * ---------------------------------------------------------------------------
 * Depuis le 1er décembre 2025, la facture normalisée est obligatoire pour
 * toutes les entreprises opérant en Côte d'Ivoire. Chaque vente doit être
 * transmise à la plateforme de la DGI via l'API publique **KOMPTO**, qui la
 * valide et lui attribue :
 *   • un numéro normé (19 chars, préfixé A pour les avoirs),
 *   • un cachet fiscal électronique,
 *   • un QR code et un lien public de vérification.
 *
 * Intégration : guide **KOMPTO API GUIDE EN v5.2** (sandbox https://qa.kompto.com)
 * Collection Postman : voir `postman/KOMPTO-Sandbox.postman_collection.json`
 *
 * Deux modes :
 *   • BROUILLON (défaut) : pas de clé API KOMPTO → numéro provisoire local
 *     `FNE-BROUILLON-...`, archivé, jamais présenté comme certifié.
 *   • CERTIFIÉ : clé API + establishment/pointOfSale configurés → la facture
 *     est transmise à KOMPTO qui la certifie auprès de la DGI.
 *
 * Deux chemins KOMPTO :
 *   Path A (recommandé) : verify (calcul + draft) → confirm (certification)
 *   Path B (direct)     : create (verify+confirm en un appel)
 *
 * Ce fichier reste l'API interne de ComptaCi pour la facturation.
 * Le client KOMPTO brut vit dans `kompto.js` — ce module y délègue et
 * conserve les helpers historiques (numeroFacture, texteFacture, etc.)
 * pour compatibilité avec FacturationFNE.jsx existante.
 *
 * Archivage légal : 10 ans → table `factures_fne` (jamais seulement la vente brute).
 */

import { supabase } from "./supabaseClient.js";
import {
  KOMPTO_API_BASE as KOMPTO_BASE,
  configKompto,
  etatKompto,
  buildVerifyPayload,
  buildConfirmPayload,
  payloadDepuisVente,
  verifyInvoice as komptoVerify,
  confirmInvoice as komptoConfirm,
  createInvoice as komptoCreate,
  getElectronicInvoice,
  parseMontantKompto,
  lienVerificationKompto,
  urlQrKompto,
  chainFromVerify,
  chainFromConfirm,
  messageErreurKompto,
} from "./kompto.js";

/** Base de l'API FNE — désormais KOMPTO (surchargeable via VITE_KOMPTO_API_URL). */
export const FNE_API_BASE = KOMPTO_BASE;

/** Portail public de vérification d'une facture. */
export const FNE_VERIF_BASE = (
  import.meta.env?.VITE_FNE_VERIF_URL ||
  import.meta.env?.VITE_KOMPTO_VERIF_URL ||
  "https://fne.dgi.gouv.ci/verification"
).replace(/\/+$/, "");

/** Durée légale de conservation des factures (années). */
export const FNE_DUREE_ARCHIVAGE_ANS = 10;

/** Ré-export du client brut pour les écrans avancés. */
export { etatKompto, configKompto, parseMontantKompto, lienVerificationKompto, urlQrKompto };

/**
 * État d'enrôlement FNE d'un établissement.
 * Hybride : accepte l'ancien modèle (fne_numero_contribuable + fne_rccm + fne_cle_api)
 * et le nouveau modèle KOMPTO (apiKey + establishment + pointOfSale).
 * @returns {{enrole: boolean, pretPourApi: boolean, manque: string[], mode: string}}
 */
export function etatEnrolement(etablissement) {
  // Priorité au modèle KOMPTO (guide v5.2)
  const kompto = etatKompto(etablissement);
  if (kompto.config.apiKey || kompto.config.establishment !== "PROGICI SARL" || etablissement?.kompto_api_key != null) {
    // L'établissement a au moins tenté la config KOMPTO → on juge sur KOMPTO
    return {
      enrole: kompto.config.establishment && kompto.config.pointOfSale ? kompto.manque.length <= 1 : false, // apiKey manquante = brouillon volontaire
      pretPourApi: kompto.pretPourApi,
      manque: kompto.manque,
      mode: kompto.mode,
    };
  }
  // Fallback legacy (avant KOMPTO) : fne_numero_contribuable + rccm + cle
  const manque = [];
  if (!etablissement?.fne_numero_contribuable) manque.push("numero_contribuable");
  if (!etablissement?.fne_rccm) manque.push("rccm");
  const pretPourApi = manque.length === 0 && Boolean(etablissement?.fne_cle_api);
  return {
    enrole: manque.length === 0,
    pretPourApi,
    manque: pretPourApi ? [] : [...manque, ...(etablissement?.fne_cle_api ? [] : ["fne_cle_api"])],
    mode: pretPourApi ? "certifie" : "brouillon",
  };
}

/** Séquence zéro-paddée sur 6 chiffres. */
const seq = (n) => String(n).padStart(6, "0");

/**
 * Numéro de facture.
 *  - Mode brouillon : référence provisoire locale (jamais présentée comme un
 *    numéro normé officiel).
 *  - Mode certifié  : le numéro renvoyé par la DGI fait foi.
 */
export function numeroFacture({ etablissement, sequence = 1, date = new Date(), certifie = false, numeroDgi = null }) {
  if (certifie && numeroDgi) return numeroDgi;
  const annee = date.getFullYear();
  const base = String(etablissement?.fne_numero_contribuable || etablissement?.kompto_etablissement || etablissement?.id || "CCI")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
  return `FNE-BROUILLON-${base}-${annee}-${seq(sequence)}`;
}

/** URL publique de vérification d'une facture normalisée. */
export function urlVerification(numero) {
  if (!numero) return null;
  return `${FNE_VERIF_BASE}?numero=${encodeURIComponent(numero)}`;
}

/**
 * Image du QR code de vérification.
 */
export function urlQrVerification(numero) {
  const url = urlVerification(numero);
  if (!url) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
}

/* -------------------------------------------------------------------------- */
/* Transmission à KOMPTO / DGI                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Construit la charge utile envoyée à l'API KOMPTO (compat legacy).
 * Pour un contrôle fin (TVA, remises, taxes TTC), utiliser directement
 * `buildVerifyPayload` de kompto.js.
 */
export function chargeUtileFne({ etablissement, vente, facture }) {
  // On produit un payload KOMPTO minimal depuis la vente
  try {
    return payloadDepuisVente({ vente, etablissement });
  } catch {
    return {
      numero_contribuable: etablissement?.fne_numero_contribuable,
      rccm: etablissement?.fne_rccm,
      etablissement: etablissement?.nom,
      date_emission: facture.dateEmission,
      numero: facture.numero,
      client: vente?.client || null,
      lignes: (facture.lignes || []).map((l) => ({
        designation: l.designation,
        quantite: l.quantite,
        prix_unitaire: l.prixUnitaire,
        montant_ht: l.montantHT,
        tva: l.tva,
        montant_ttc: l.montantTTC,
      })),
      montant_ht: facture.montantHT,
      tva: facture.tva,
      montant_ttc: facture.montantTTC,
    };
  }
}

/**
 * Transmet une facture à KOMPTO (Path A complet : verify → confirm).
 * Si la config KOMPTO est incomplète, rend un brouillon sans appel réseau.
 * @returns {Promise<{ok: boolean, mode: string, donnees?: Object, erreur?: string, kompto?: object}>}
 */
export async function transmettreFacture({ etablissement, vente, facture, clientOverrides = {}, confirmOverrides = {} }) {
  const komptoEtat = etatKompto(etablissement);
  if (!komptoEtat.pretPourApi) {
    return { ok: false, mode: "brouillon", erreur: "api_non_configuree" };
  }
  const cfg = komptoEtat.config;
  try {
    // 1) verify — calcul côté KOMPTO/DGI
    const verifyPayload = payloadDepuisVente({ vente, etablissement, clientOverrides });
    // si la facture locale a des lignes précises, on les écrase
    if (facture?.lignes?.length) {
      verifyPayload.items = facture.lignes.map((l) => ({
        itemName: l.designation || "Vente",
        itemReference: l.reference || null,
        itemUnitOfMeasure: l.unite || "Unit",
        itemQuantity: Number(l.quantite) || 1,
        itemUnitPrice: Number(l.prixUnitaire) || 0,
        itemDiscountPercent: l.remise != null ? Number(l.remise) : null,
        itemTVAName: l.tvaNom || "TVA",
        itemTaxTTC1Name: null,
        itemTaxTTC1Percent: null,
        itemTaxTTC2Name: null,
        itemTaxTTC2Percent: null,
      }));
    }
    const vRes = await komptoVerify(verifyPayload, cfg);
    if (!vRes.isOk) {
      return { ok: false, mode: "certifie", erreur: messageErreurKompto(vRes), details: vRes.error, raw: vRes };
    }
    const chainV = chainFromVerify(vRes.invoice);

    // 2) confirm — certification DGI
    const confirmPayload = buildConfirmPayload({
      komptoEntryId: chainV.komptoEntryId,
      establishment: confirmOverrides.establishment || cfg.establishment,
      pointOfSale: confirmOverrides.pointOfSale || cfg.pointOfSale,
      paymentMethod: confirmOverrides.paymentMethod || "transfer",
      isRNE: confirmOverrides.isRNE || false,
      numberRNE: confirmOverrides.numberRNE || null,
      otherInfo: confirmOverrides.otherInfo || null,
      footer: confirmOverrides.footer || null,
    });
    const cRes = await komptoConfirm(confirmPayload, cfg);
    if (!cRes.isOk) {
      return { ok: false, mode: "certifie", erreur: messageErreurKompto(cRes), details: cRes.error, raw: cRes, verify: vRes.invoice };
    }
    const chainC = chainFromConfirm(cRes.invoice);
    return {
      ok: true,
      mode: "certifie",
      donnees: cRes.invoice,
      kompto: { verify: vRes.invoice, confirm: cRes.invoice, chain: { ...chainV, ...chainC } },
      numberFNE: cRes.invoice.numberFNE,
      linkFNE: cRes.invoice.linkFNE,
    };
  } catch (e) {
    return { ok: false, mode: "certifie", erreur: String(e?.message || e) };
  }
}

/**
 * Variante Path B : create direct (verify+confirm en un appel).
 * À n'utiliser que quand les montants sont sûrs.
 */
export async function transmettreFactureDirecte({ etablissement, vente, facture, clientOverrides = {}, confirmOverrides = {}, itemsOverride = null }) {
  const komptoEtat = etatKompto(etablissement);
  if (!komptoEtat.pretPourApi) return { ok: false, mode: "brouillon", erreur: "api_non_configuree" };
  const cfg = komptoEtat.config;
  try {
    const baseVerify = payloadDepuisVente({ vente, etablissement, clientOverrides, itemsOverride });
    if (facture?.lignes?.length && !itemsOverride) {
      baseVerify.items = facture.lignes.map((l) => ({
        itemName: l.designation || "Vente",
        itemReference: null,
        itemUnitOfMeasure: "Unit",
        itemQuantity: Number(l.quantite) || 1,
        itemUnitPrice: Number(l.prixUnitaire) || 0,
        itemDiscountPercent: null,
        itemTVAName: "TVA",
        itemTaxTTC1Name: null,
        itemTaxTTC1Percent: null,
        itemTaxTTC2Name: null,
        itemTaxTTC2Percent: null,
      }));
    }
    const payload = {
      ...baseVerify,
      establishment: confirmOverrides.establishment || cfg.establishment,
      pointOfSale: confirmOverrides.pointOfSale || cfg.pointOfSale,
      paymentMethod: confirmOverrides.paymentMethod || "transfer",
      isRNE: Boolean(confirmOverrides.isRNE),
      numberRNE: confirmOverrides.isRNE ? confirmOverrides.numberRNE || null : null,
      otherInfo: confirmOverrides.otherInfo || null,
      footer: confirmOverrides.footer || null,
    };
    const res = await komptoCreate(payload, cfg);
    if (!res.isOk) return { ok: false, mode: "certifie", erreur: messageErreurKompto(res), details: res.error, raw: res };
    return { ok: true, mode: "certifie", donnees: res.invoice, numberFNE: res.invoice.numberFNE, linkFNE: res.invoice.linkFNE };
  } catch (e) {
    return { ok: false, mode: "certifie", erreur: String(e?.message || e) };
  }
}

/* -------------------------------------------------------------------------- */
/* Persistance (archivage légal 10 ans)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Enregistre la facture dans `factures_fne`.
 * Supporte les colonnes KOMPTO (kompto_entry_id, number_fne, link_fne…)
 * si la migration supabase-kompto.sql a été appliquée — sinon retombe
 * sur le schéma legacy.
 */
export async function archiverFacture({ etablissement, vente, facture, transmission }) {
  if (!supabase) return { ok: false, erreur: "supabase_non_configure" };
  if (!etablissement?.id) return { ok: false, erreur: "etablissement_manquant" };
  const isCertifie = Boolean(transmission?.ok);
  const donnees = transmission?.donnees || transmission?.kompto?.confirm || null;
  // Montants : si la réponse KOMPTO fournit des strings, on les décode, sinon on garde le local
  const montantHT = donnees ? parseMontantKompto(donnees.entryTotalPriceDiscountedHT ?? donnees.entryTotalPriceHT ?? facture.montantHT) : facture.montantHT;
  const tvaVal = donnees ? parseMontantKompto(donnees.entryTotalTVA ?? facture.tva) : facture.tva;
  const montantTTC = donnees ? parseMontantKompto(donnees.entryTotalPriceTTC ?? facture.montantTTC) : facture.montantTTC;
  const entryTimbre = donnees ? parseMontantKompto(donnees.entryTimbre ?? 0) : 0;
  const numeroCertifie = donnees?.numberFNE || (isCertifie ? facture.numero : facture.numero);
  const lien = donnees?.linkFNE || lienVerificationKompto(donnees) || urlVerification(numeroCertifie);
  const komptoEntryId = donnees?.komptoEntryId ? String(donnees.komptoEntryId) : transmission?.kompto?.verify?.komptoEntryId ? String(transmission.kompto.verify.komptoEntryId) : null;
  const komptoItemIds = donnees?.items ? donnees.items.map((i) => i.komptoItemId).filter(Boolean) : transmission?.kompto?.verify?.items ? transmission.kompto.verify.items.map((i) => i.komptoItemId) : null;

  const base = {
    etablissement_id: etablissement.id,
    transaction_id: vente?.id || null,
    numero: numeroCertifie,
    statut: isCertifie ? "certifiee" : "brouillon",
    date_emission: facture.dateEmission,
    montant_ht: montantHT,
    tva: tvaVal,
    montant_ttc: montantTTC,
    lignes: facture.lignes || [],
    reponse_dgi: donnees || null,
    erreur_dgi: transmission?.erreur || null,
    conserve_jusqua: new Date(new Date().setFullYear(new Date().getFullYear() + FNE_DUREE_ARCHIVAGE_ANS)).toISOString().slice(0, 10),
  };

  // Tentative avec colonnes KOMPTO ; si la migration n'est pas appliquée, on retombe.
  const tentatives = [
    {
      ...base,
      kompto_entry_id: komptoEntryId,
      kompto_item_ids: komptoItemIds ? JSON.stringify(komptoItemIds) : null,
      number_fne: donnees?.numberFNE || null,
      link_fne: lien,
      type_fne: donnees?.typeFNE || null,
      date_time_fne: donnees?.dateTimeFNE || null,
      entry_timbre: entryTimbre || null,
      sticker_fne_balance: donnees?.stickerFNEbalance ?? null,
      kompto_parent_id: donnees?.komptoEntryParentId ? String(donnees.komptoEntryParentId) : null,
    },
    base,
  ];

  for (const ligne of tentatives) {
    try {
      const { data, error } = await supabase.from("factures_fne").insert(ligne).select("*").limit(1);
      if (error) throw error;
      return { ok: true, facture: data?.[0] || ligne };
    } catch (e) {
      const msg = String(e?.message || e);
      // colonne manquante → on tente la suivante (schéma legacy)
      if (/kompto|number_fne|link_fne|type_fne|date_time_fne|entry_timbre|sticker|kompto_parent/i.test(msg)) {
        continue;
      }
      return { ok: false, erreur: msg, facture: ligne };
    }
  }
  return { ok: false, erreur: "archivage_impossible", facture: base };
}

/** Liste les factures FNE d'un établissement. */
export async function chargerFactures(etablissementId, limite = 100) {
  if (!supabase || !etablissementId) return [];
  try {
    const { data, error } = await supabase
      .from("factures_fne")
      .select("*")
      .eq("etablissement_id", etablissementId)
      .order("date_emission", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error("FNE — chargement factures :", e);
    return [];
  }
}

/**
 * Recharge une facture certifiée depuis KOMPTO (source de vérité après certification).
 */
export async function chargerFactureCertifiee({ etablissement, komptoEntryId }) {
  const cfg = configKompto(etablissement);
  if (!cfg.apiKey || !komptoEntryId) return null;
  const res = await getElectronicInvoice(komptoEntryId, cfg);
  return res.isOk ? res.invoice : null;
}

/* -------------------------------------------------------------------------- */
/* Rendu textuel / impression                                                  */
/* -------------------------------------------------------------------------- */

const fmt = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

/** Facture au format texte, prête pour l'impression ou le partage. */
export function texteFacture({ etablissement, facture, certifie }) {
  const numero = facture.numberFNE || facture.numero;
  const estCertifie = Boolean(certifie || facture.certifie || facture.numberFNE || facture.number_fne);
  const config = configKompto(etablissement);
  const lien = facture.linkFNE || facture.link_fne || (estCertifie ? lienVerificationKompto(facture) : null) || urlVerification(numero);
  const lignes = [
    `============================================`,
    `${etablissement?.nom || "Établissement"}`,
    `N° contribuable : ${etablissement?.fne_numero_contribuable || etablissement?.kompto_etablissement || "—"}`,
    `RCCM : ${etablissement?.fne_rccm || "—"}`,
    ...(config.establishment && config.establishment !== etablissement?.nom ? [`Émetteur KOMPTO : ${config.establishment} / ${config.pointOfSale}`] : []),
    `============================================`,
    `FACTURE NORMALISÉE`,
    `Numéro : ${numero}`,
    estCertifie ? `Statut : CERTIFIÉE PAR LA DGI` : `Statut : BROUILLON — en attente de certification DGI`,
    `Date d'émission : ${facture.dateEmission || facture.date_emission || facture.date_time_fne || "—"}`,
    ...(facture.dateTimeFNE || facture.date_time_fne ? [`Certifiée le : ${facture.dateTimeFNE || facture.date_time_fne}`] : []),
    ``,
    `Désignation                Qté    PU        TTC`,
  ];
  (facture.lignes || facture.items || facture.lignes || []).forEach((l) => {
    const nom = (l.designation || l.itemName || "").padEnd(26).slice(0, 26);
    const qte = String(l.quantite ?? l.itemQuantity ?? "").padEnd(7);
    const pu = fmt(l.prixUnitaire ?? l.itemUnitPrice ?? 0).padEnd(10);
    const ttc = fmt(l.montantTTC ?? parseMontantKompto(l.itemTotalPriceTTC ?? l.montantTTC) ?? 0);
    lignes.push(`${nom}${qte}${pu}${ttc}`);
  });
  lignes.push(``);
  // Totaux : on préfère les champs KOMPTO décodés si présents
  const ht = facture.entryTotalPriceDiscountedHT != null ? parseMontantKompto(facture.entryTotalPriceDiscountedHT) : facture.montantHT ?? facture.montant_ht ?? 0;
  const tva = facture.entryTotalTVA != null ? parseMontantKompto(facture.entryTotalTVA) : facture.tva ?? 0;
  const ttc = facture.entryTotalPriceTTC != null ? parseMontantKompto(facture.entryTotalPriceTTC) : facture.montantTTC ?? facture.montant_ttc ?? 0;
  const du = facture.entryTotalDue != null ? parseMontantKompto(facture.entryTotalDue) : ttc;
  const timbre = facture.entryTimbre != null ? parseMontantKompto(facture.entryTimbre) : facture.entry_timbre ?? 0;
  lignes.push(`Total HT  : ${fmt(ht)} FCFA`);
  lignes.push(`TVA       : ${fmt(tva)} FCFA`);
  if (timbre) lignes.push(`Timbre    : ${fmt(timbre)} FCFA`);
  lignes.push(`Total TTC : ${fmt(ttc)} FCFA`);
  if (du !== ttc) lignes.push(`Net à payer : ${fmt(du)} FCFA`);
  if (facture.entryTotalDueFX && facture.foreignCurrencyName) {
    lignes.push(`Soit ${fmt(parseMontantKompto(facture.entryTotalDueFX))} ${facture.foreignCurrencyName} (taux ${facture.exchangeRateCFAtoFX})`);
  }
  if (lien) {
    lignes.push(``);
    lignes.push(`Vérification : ${lien}`);
  }
  if (facture.sellerNCC || facture.clientNCC) {
    lignes.push(``);
    if (facture.sellerNCC) lignes.push(`Vendeur NCC : ${facture.sellerNCC}`);
    if (facture.clientNCC) lignes.push(`Client NCC  : ${facture.clientNCC}`);
  }
  if (!estCertifie) {
    lignes.push(``);
    lignes.push(`Document provisoire généré par ComptaCi. Pour obtenir le numéro normé et`);
    lignes.push(`le cachet officiel, finalisez l'enrôlement KOMPTO de votre établissement.`);
    lignes.push(`Sandbox KOMPTO : factures au nom de ${config.establishment} / ${config.pointOfSale} — sans valeur fiscale.`);
  }
  lignes.push(`============================================`);
  return lignes.join("\n");
}

/**
 * Construit une facture normalisée à partir d'une vente (mode local).
 * Le taux de TVA est celui en vigueur en Côte d'Ivoire (18 %).
 * Pour une facture KOMPTO complète, utiliser `payloadDepuisVente` + API.
 */
export function construireFacture({ vente, etablissement, sequence = 1, maintenant = new Date() }) {
  const quantite = Number(vente?.quantite) || 1;
  const prixUnitaire = Number(vente?.prixUnitaire) || Number(vente?.montant) || 0;
  const montantTTC = Number(vente?.montant) || quantite * prixUnitaire;
  const montantHT = montantTTC / 1.18;
  const tva = montantTTC - montantHT;

  const certifie = etatEnrolement(etablissement).pretPourApi;

  return {
    numero: numeroFacture({ etablissement, sequence, date: maintenant, certifie }),
    dateEmission: (vente?.date || maintenant.toISOString()).slice(0, 10),
    certifie,
    lignes: [
      {
        designation: vente?.designation || "Vente",
        quantite,
        prixUnitaire,
        montantHT,
        tva,
        montantTTC,
      },
    ],
    montantHT,
    tva,
    montantTTC,
  };
}
