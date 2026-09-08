/**
 * fne.js — Facture Normalisée Électronique (FNE / DGI Côte d'Ivoire)
 * ---------------------------------------------------------------------------
 * Depuis le 1er décembre 2025, la facture normalisée est obligatoire pour
 * toutes les entreprises opérant en Côte d'Ivoire. Chaque vente doit être
 * transmise à la plateforme de la DGI, qui la valide et lui attribue :
 *   • un numéro normé,
 *   • un cachet fiscal électronique (visuel officiel FNE),
 *   • un QR code de vérification.
 *
 * IMPORTANT — Prérequis administratif :
 *   ComptaCi ne peut PAS enrôler un établissement à sa place. Le client doit
 *   d'abord être enrôlé sur la plateforme FNE (numéro de contribuable + RCCM)
 *   et récupérer ses identifiants d'API. Ce module accompagne cette démarche
 *   et produit des factures conformes dès que les identifiants sont saisis.
 *
 * Deux modes :
 *   • BROUILLON (défaut) : l'établissement n'a pas encore saisi sa clé API DGI.
 *     La facture est générée et archivée localement avec un numéro provisoire,
 *     clairement marqué « en attente de certification DGI ». Aucune donnée n'est
 *     envoyée tant que la clé n'est pas renseignée.
 *   • CERTIFIÉ : une clé API est configurée → la facture est transmise à
 *     l'API DGI, qui renvoie le numéro normé, le cachet et le QR officiels.
 *
 * Archivage légal : 6 à 10 ans → chaque facture générée est conservée en base
 * (table `factures_fne`), jamais seulement l'enregistrement de vente brut.
 */

import { supabase } from "./supabaseClient.js";

/** Base de l'API FNE (surchargeable via VITE_FNE_API_URL). */
export const FNE_API_BASE = (
  import.meta.env?.VITE_FNE_API_URL || "https://fne.dgi.gouv.ci/api/v1"
).replace(/\/+$/, "");

/** Portail public de vérification d'une facture. */
export const FNE_VERIF_BASE = (
  import.meta.env?.VITE_FNE_VERIF_URL || "https://fne.dgi.gouv.ci/verification"
).replace(/\/+$/, "");

/** Durée légale de conservation des factures (années). */
export const FNE_DUREE_ARCHIVAGE_ANS = 10;

/**
 * État d'enrôlement FNE d'un établissement.
 * @returns {{enrole: boolean, pretPourApi: boolean, manque: string[]}}
 */
export function etatEnrolement(etablissement) {
  const manque = [];
  if (!etablissement?.fne_numero_contribuable) manque.push("numero_contribuable");
  if (!etablissement?.fne_rccm) manque.push("rccm");
  const pretPourApi = manque.length === 0 && Boolean(etablissement?.fne_cle_api);
  return {
    enrole: manque.length === 0,
    pretPourApi,
    manque,
    // Sans clé API, on reste en brouillon : c'est volontaire et réversible.
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
  const base = String(etablissement?.fne_numero_contribuable || etablissement?.id || "CCI")
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
 * On utilise un service de rendu QR public : si le réseau ou le service est
 * indisponible, l'UI affiche le lien textuel à la place (dégradé propre).
 */
export function urlQrVerification(numero) {
  const url = urlVerification(numero);
  if (!url) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
}

/* -------------------------------------------------------------------------- */
/* Transmission à la DGI                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Construit la charge utile envoyée à l'API FNE.
 * Les noms de champs suivent la structure habituelle des API de facturation
 * normalisée ; à ajuster dès que la documentation technique officielle de la
 * DGI est entre les mains de l'équipe (c'est le préalable de l'étape 5).
 */
export function chargeUtileFne({ etablissement, vente, facture }) {
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

/**
 * Transmet une facture à la plateforme DGI.
 * @returns {Promise<{ok: boolean, mode: string, donnees?: Object, erreur?: string}>}
 */
export async function transmettreFacture({ etablissement, vente, facture }) {
  const etat = etatEnrolement(etablissement);
  if (!etat.pretPourApi) {
    return { ok: false, mode: "brouillon", erreur: "api_non_configuree" };
  }
  try {
    const reponse = await fetch(`${FNE_API_BASE}/factures`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${etablissement.fne_cle_api}`,
      },
      body: JSON.stringify(chargeUtileFne({ etablissement, vente, facture })),
    });
    if (!reponse.ok) {
      return {
        ok: false,
        mode: "certifie",
        erreur: `HTTP ${reponse.status}`,
      };
    }
    const donnees = await reponse.json();
    return { ok: true, mode: "certifie", donnees };
  } catch (e) {
    return { ok: false, mode: "certifie", erreur: String(e?.message || e) };
  }
}

/* -------------------------------------------------------------------------- */
/* Persistance (archivage légal 10 ans)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Enregistre la facture dans `factures_fne`.
 * Ne lève jamais : un échec d'archivage ne doit pas bloquer la vente.
 */
export async function archiverFacture({ etablissement, vente, facture, transmission }) {
  if (!supabase) return { ok: false, erreur: "supabase_non_configure" };
  if (!etablissement?.id) return { ok: false, erreur: "etablissement_manquant" };
  const ligne = {
    etablissement_id: etablissement.id,
    transaction_id: vente?.id || null,
    numero: facture.numero,
    statut: transmission?.ok ? "certifiee" : "brouillon",
    date_emission: facture.dateEmission,
    montant_ht: facture.montantHT,
    tva: facture.tva,
    montant_ttc: facture.montantTTC,
    lignes: facture.lignes || [],
    reponse_dgi: transmission?.donnees || null,
    erreur_dgi: transmission?.erreur || null,
    conserve_jusqua: new Date(
      new Date().setFullYear(new Date().getFullYear() + FNE_DUREE_ARCHIVAGE_ANS)
    )
      .toISOString()
      .slice(0, 10),
  };
  try {
    const { data, error } = await supabase.from("factures_fne").insert(ligne).select("*").limit(1);
    if (error) throw error;
    return { ok: true, facture: data?.[0] || ligne };
  } catch (e) {
    // La table n'existe peut-être pas encore (migration non appliquée) :
    // on prévient sans bloquer la génération de la facture.
    return { ok: false, erreur: String(e?.message || e), facture: ligne };
  }
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

/* -------------------------------------------------------------------------- */
/* Rendu textuel / impression                                                  */
/* -------------------------------------------------------------------------- */

const fmt = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

/** Facture au format texte, prête pour l'impression ou le partage. */
export function texteFacture({ etablissement, facture, certifie }) {
  const lignes = [
    `============================================`,
    `${etablissement?.nom || "Établissement"}`,
    `N° contribuable : ${etablissement?.fne_numero_contribuable || "—"}`,
    `RCCM : ${etablissement?.fne_rccm || "—"}`,
    `============================================`,
    `FACTURE NORMALISÉE`,
    `Numéro : ${facture.numero}`,
    certifie ? `Statut : CERTIFIÉE PAR LA DGI` : `Statut : BROUILLON — en attente de certification DGI`,
    `Date d'émission : ${facture.dateEmission}`,
    ``,
    `Désignation                Qté    PU        TTC`,
  ];
  (facture.lignes || []).forEach((l) => {
    const nom = (l.designation || "").padEnd(26).slice(0, 26);
    lignes.push(`${nom}${String(l.quantite).padEnd(7)}${fmt(l.prixUnitaire).padEnd(10)}${fmt(l.montantTTC)}`);
  });
  lignes.push(``);
  lignes.push(`Total HT  : ${fmt(facture.montantHT)} FCFA`);
  lignes.push(`TVA 18 %  : ${fmt(facture.tva)} FCFA`);
  lignes.push(`Total TTC : ${fmt(facture.montantTTC)} FCFA`);
  if (urlVerification(facture.numero)) {
    lignes.push(``);
    lignes.push(`Vérification : ${urlVerification(facture.numero)}`);
  }
  if (!certifie) {
    lignes.push(``);
    lignes.push(
      `Document provisoire généré par ComptaCi. Pour obtenir le numéro normé et`
    );
    lignes.push(
      `le cachet officiel, finalisez l'enrôlement FNE de votre établissement.`
    );
  }
  lignes.push(`============================================`);
  return lignes.join("\n");
}

/**
 * Construit une facture normalisée à partir d'une vente.
 * Le taux de TVA est celui en vigueur en Côte d'Ivoire (18 %).
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
