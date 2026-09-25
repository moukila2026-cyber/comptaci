import React, { useEffect, useMemo, useState } from "react";
import {
  FileText,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Printer,
  MessageCircle,
  Lock,
  Settings2,
  CheckCircle,
  XCircle,
  ExternalLink,
  RefreshCw,
  Trash2,
  RotateCcw,
  Search,
  Plus,
  Eye,
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import PaiementFNE from "./PaiementFNE.jsx";
import {
  etatEnrolement,
  etatKompto,
  configKompto,
  construireFacture,
  archiverFacture,
  chargerFactures,
  texteFacture,
  urlVerification,
  urlQrVerification,
  FNE_DUREE_ARCHIVAGE_ANS,
} from "./fne.js";
import {
  KOMPTO_DEFAULTS,
  KOMPTO_PAYMENT_METHODS,
  KOMPTO_TVA_CODES,
  KOMPTO_API_BASE,
  parseMontantKompto,
  parsePourcentKompto,
  totauxDecodes,
  buildVerifyPayload,
  buildConfirmPayload,
  buildCreatePayload,
  checkApiKey,
  verifyInvoice,
  confirmInvoice,
  createInvoice,
  getVerify,
  getElectronicInvoice,
  createCreditNote,
  deleteDraft,
  lienVerificationKompto,
  urlQrKompto,
  parseDateTimeFNE,
  messageErreurKompto,
  chainFromVerify,
  chainFromConfirm,
} from "./kompto.js";

const fmt = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const fmtComma = (s) => {
  const n = parseMontantKompto(s);
  return fmt(n);
};

/** Plans donnant accès à la facturation normalisée. */
const PLANS_FNE = ["pro", "entreprise"];

const CLIENT_TYPES = ["B2B", "B2C", "B2G", "B2F"];
const PAYMENT_LABELS = {
  cash: "Espèces (timbre DGI)",
  card: "Carte",
  check: "Chèque",
  "mobile-money": "Mobile Money",
  transfer: "Virement (recommandé en sandbox)",
  deferred: "Différé",
};

const TVA_LABELS = {
  TVA: "TVA 18% (standard)",
  TVAB: "TVAB 9% (réduit)",
  TVAC: "TVAC 0% (exonéré C)",
  TVAD: "TVAD 0% (exonéré D)",
  TVAE: "TVAE 0% (exonéré E)",
};

export default function FacturationFNE({ etablissement, transactions, planEffectif, enEssai, t, onRafraichirEtablissement }) {
  // ----- FNE option gating (100k/an/établissement, disponible sur tous les plans) -----
  const fneStatutBrut = etablissement?.fne_statut ?? null;
  const fneExpiration = etablissement?.fne_expiration_date || null;
  const hasFneCol = etablissement && Object.prototype.hasOwnProperty.call(etablissement, "fne_statut");
  const fneStatutEffectif = (() => {
    if (!hasFneCol) {
      // migration pas encore appliquée → fallback legacy (Pro/Entreprise ou essai)
      return PLANS_FNE.includes(planEffectif) || enEssai ? "active" : "aucune";
    }
    const brut = fneStatutBrut || "aucune";
    if ((brut === "active" || brut === "en_cours") && fneExpiration) {
      const exp = new Date(fneExpiration);
      exp.setHours(23, 59, 59, 999);
      if (exp < new Date()) return "expiree";
    }
    return brut;
  })();
  const aAcces = fneStatutEffectif === "active";
  const estEnCours = fneStatutEffectif === "en_cours";
  const estExpiree = fneStatutEffectif === "expiree";
  const estSansFne = fneStatutEffectif === "aucune";
  const legacyEtat = etatEnrolement(etablissement);
  const komptoEtat = etatKompto(etablissement);
  // on privilégie l'état KOMPTO s'il est renseigné, sinon fallback legacy
  const etat = komptoEtat.config.apiKey || etablissement?.kompto_api_key != null ? komptoEtat : legacyEtat;

  const [onglet, setOnglet] = useState("enrolement");
  const cfg = configKompto(etablissement);

  // ---------- Enrôlement KOMPTO ----------
  const [formulaire, setFormulaire] = useState({
    kompto_api_key: etablissement?.kompto_api_key || etablissement?.kompto_cle_api || etablissement?.fne_cle_api || "",
    kompto_base_url: cfg.baseUrl || KOMPTO_DEFAULTS.baseUrl,
    kompto_etablissement: cfg.establishment || KOMPTO_DEFAULTS.establishment,
    kompto_point_de_vente: cfg.pointOfSale || KOMPTO_DEFAULTS.pointOfSale,
    // legacy fallback
    fne_numero_contribuable: etablissement?.fne_numero_contribuable || "",
    fne_rccm: etablissement?.fne_rccm || "",
  });
  const [enregistrement, setEnregistrement] = useState(false);
  const [testCle, setTestCle] = useState({ loading: false, result: null });
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const c = configKompto(etablissement);
    setFormulaire({
      kompto_api_key: etablissement?.kompto_api_key || etablissement?.kompto_cle_api || etablissement?.fne_cle_api || "",
      kompto_base_url: c.baseUrl || KOMPTO_DEFAULTS.baseUrl,
      kompto_etablissement: c.establishment || KOMPTO_DEFAULTS.establishment,
      kompto_point_de_vente: c.pointOfSale || KOMPTO_DEFAULTS.pointOfSale,
      fne_numero_contribuable: etablissement?.fne_numero_contribuable || "",
      fne_rccm: etablissement?.fne_rccm || "",
    });
  }, [etablissement?.id, etablissement?.kompto_api_key, etablissement?.fne_cle_api, etablissement?.kompto_base_url, etablissement?.kompto_etablissement, etablissement?.kompto_point_de_vente]);

  // ---------- Factures archivées ----------
  const [factures, setFactures] = useState([]);
  useEffect(() => {
    if (!aAcces || !etablissement?.id) return;
    chargerFactures(etablissement.id).then(setFactures);
  }, [aAcces, etablissement?.id]);

  // ---------- Client & Facturation ----------
  const [client, setClient] = useState({
    clientType: "B2B",
    clientName: KOMPTO_DEFAULTS.clientName,
    clientNCC: KOMPTO_DEFAULTS.clientNCC,
    clientTelephone: KOMPTO_DEFAULTS.clientTelephone,
    clientEmail: KOMPTO_DEFAULTS.clientEmail,
    foreignCurrencyName: "",
    exchangeRateCFAtoFX: "",
  });
  const [paymentMethod, setPaymentMethod] = useState(KOMPTO_DEFAULTS.paymentMethod);
  const [isRNE, setIsRNE] = useState(false);
  const [numberRNE, setNumberRNE] = useState("");
  const [otherInfo, setOtherInfo] = useState("");
  const [footer, setFooter] = useState("");
  const [entryTax1, setEntryTax1] = useState({ name: "", percent: "" });
  const [entryTax2, setEntryTax2] = useState({ name: "", percent: "" });

  // items
  const [items, setItems] = useState([
    {
      id: 1,
      itemName: "Consulting service",
      itemReference: "",
      itemUnitOfMeasure: "Unit",
      itemQuantity: 2,
      itemUnitPrice: 50000,
      itemDiscountPercent: 10,
      itemTVAName: "TVA",
      itemTaxTTC1Name: "",
      itemTaxTTC1Percent: "",
      itemTaxTTC2Name: "",
      itemTaxTTC2Percent: "",
    },
    {
      id: 2,
      itemName: "Equipment supply",
      itemReference: "",
      itemUnitOfMeasure: "Unit",
      itemQuantity: 5,
      itemUnitPrice: 8000,
      itemDiscountPercent: "",
      itemTVAName: "TVA",
      itemTaxTTC1Name: "",
      itemTaxTTC1Percent: "",
      itemTaxTTC2Name: "",
      itemTaxTTC2Percent: "",
    },
  ]);

  // chaining
  const [draft, setDraft] = useState(null); // invoice from verify
  const [confirmed, setConfirmed] = useState(null);
  const [komptoEntryId, setKomptoEntryId] = useState("");
  const [komptoItemId, setKomptoItemId] = useState("");
  const [confirmedEntryId, setConfirmedEntryId] = useState("");
  const [numberFNE, setNumberFNE] = useState("");
  const [linkFNE, setLinkFNE] = useState("");
  const [creditNoteItemId, setCreditNoteItemId] = useState("");

  // credit note
  const [avoirQuantite, setAvoirQuantite] = useState(1);

  // retrieval
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupMode, setLookupMode] = useState("getElectronicInvoice"); // or getVerify

  const [loading, setLoading] = useState(null); // verify | confirm | create | credit | delete | lookup
  const [generationEnCours, setGenerationEnCours] = useState(null);
  const [factureActive, setFactureActive] = useState(null);

  const ventesRecentes = useMemo(() => (transactions || []).filter((tx) => tx.type === "vente").slice(0, 30), [transactions]);

  // ---------- Actions Enrôlement ----------
  const enregistrerEnrolement = async () => {
    if (!supabase) {
      setMessage({ type: "ko", texte: t("fne_erreur_migration") });
      return;
    }
    if (!etablissement?.id) return;
    setEnregistrement(true);
    setMessage(null);
    try {
      const payload = {
        kompto_api_key: formulaire.kompto_api_key.trim() || null,
        kompto_base_url: formulaire.kompto_base_url.trim() || KOMPTO_DEFAULTS.baseUrl,
        kompto_etablissement: formulaire.kompto_etablissement.trim() || KOMPTO_DEFAULTS.establishment,
        kompto_point_de_vente: formulaire.kompto_point_de_vente.trim() || KOMPTO_DEFAULTS.pointOfSale,
        // legacy mirror for backward compat
        fne_cle_api: formulaire.kompto_api_key.trim() || null,
        fne_numero_contribuable: formulaire.fne_numero_contribuable.trim() || null,
        fne_rccm: formulaire.fne_rccm.trim() || null,
      };
      // try with kompto columns, fallback to legacy if migration not applied
      let error = null;
      try {
        const res = await supabase.from("etablissements").update(payload).eq("id", etablissement.id);
        error = res.error;
        if (error && /kompto/i.test(error.message)) throw error;
      } catch (e) {
        if (/kompto/i.test(String(e.message))) {
          const fallback = await supabase
            .from("etablissements")
            .update({
              fne_cle_api: payload.fne_cle_api,
              fne_numero_contribuable: payload.fne_numero_contribuable,
              fne_rccm: payload.fne_rccm,
            })
            .eq("id", etablissement.id);
          error = fallback.error;
        } else throw e;
      }
      if (error) throw error;
      setMessage({ type: "ok", texte: t("fne_enregistre_ok") });
      onRafraichirEtablissement?.();
    } catch (e) {
      const msg = String(e?.message || e);
      setMessage({
        type: "ko",
        texte: /kompto|fne_|does not exist|schema cache/i.test(msg) ? t("fne_erreur_migration") : t("fne_erreur_enregistrement"),
      });
    } finally {
      setEnregistrement(false);
    }
  };

  const testerCle = async () => {
    const baseUrl = formulaire.kompto_base_url.trim() || KOMPTO_DEFAULTS.baseUrl;
    const apiKey = formulaire.kompto_api_key.trim();
    if (!apiKey) {
      setTestCle({ loading: false, result: { ok: false, message: "Collez d'abord votre clé API sandbox." } });
      return;
    }
    setTestCle({ loading: true, result: null });
    const res = await checkApiKey({ baseUrl, apiKey });
    if (res.status === 401) {
      setTestCle({ loading: false, result: { ok: false, message: "401 — Clé invalide. Vérifiez l'en-tête Bearer.", raw: res.body } });
    } else if (res.status === 404) {
      setTestCle({ loading: false, result: { ok: true, message: '404 "La commande n\'existe pas." — clé acceptée (auth OK, seul l\'id 0 est faux).', raw: res.body } });
    } else {
      setTestCle({ loading: false, result: { ok: res.ok, message: `HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 200)}`, raw: res.body } });
    }
  };

  // ---------- Payload builders ----------
  const buildCurrentVerifyPayload = () => {
    return buildVerifyPayload({
      clientType: client.clientType,
      clientName: client.clientName,
      clientNCC: client.clientType === "B2B" ? client.clientNCC || null : null,
      clientTelephone: client.clientTelephone,
      clientEmail: client.clientEmail,
      foreignCurrencyName: client.clientType === "B2F" && client.foreignCurrencyName ? client.foreignCurrencyName : null,
      exchangeRateCFAtoFX: client.clientType === "B2F" && client.exchangeRateCFAtoFX ? Number(client.exchangeRateCFAtoFX) : null,
      entryTaxTTC1Name: entryTax1.name || null,
      entryTaxTTC1Percent: entryTax1.percent !== "" ? Number(entryTax1.percent) : null,
      entryTaxTTC2Name: entryTax2.name || null,
      entryTaxTTC2Percent: entryTax2.percent !== "" ? Number(entryTax2.percent) : null,
      items: items.map((it) => ({
        itemName: it.itemName,
        itemReference: it.itemReference || null,
        itemUnitOfMeasure: it.itemUnitOfMeasure || null,
        itemQuantity: Number(it.itemQuantity),
        itemUnitPrice: Number(it.itemUnitPrice),
        itemDiscountPercent: it.itemDiscountPercent !== "" && it.itemDiscountPercent != null ? Number(it.itemDiscountPercent) : null,
        itemTVAName: it.itemTVAName,
        itemTaxTTC1Name: it.itemTaxTTC1Name || null,
        itemTaxTTC1Percent: it.itemTaxTTC1Percent !== "" ? Number(it.itemTaxTTC1Percent) : null,
        itemTaxTTC2Name: it.itemTaxTTC2Name || null,
        itemTaxTTC2Percent: it.itemTaxTTC2Percent !== "" ? Number(it.itemTaxTTC2Percent) : null,
      })),
    });
  };

  // ---------- Verify ----------
  const handleVerify = async () => {
    if (!etablissement?.id) return;
    if (hasFneCol && fneStatutEffectif !== "active") {
      setMessage({
        type: "ko",
        texte:
          fneStatutEffectif === "expiree"
            ? "Option FNE expirée — renouvelez l’option (100 000 FCFA/an) avant de certifier. La certification est coupée."
            : estEnCours
              ? "Option FNE en_cours — finalisez la connexion KOMPTO dans l’onglet Enrôlement (clé + establishment/pointOfSale/NCC) pour débloquer la certification."
              : "Option FNE non active (aucune) — réglez l’option 100 000 FCFA/an par établissement pour certifier vos factures DGI.",
      });
      return;
    }
    const cfgLocal = {
      baseUrl: formulaire.kompto_base_url.trim() || cfg.baseUrl,
      apiKey: formulaire.kompto_api_key.trim() || cfg.apiKey,
    };
    if (!cfgLocal.apiKey) {
      setMessage({ type: "ko", texte: "Clé API KOMPTO vide — renseignez-la dans Enrôlement, ou la facture restera en BROUILLON local." });
      return;
    }
    setLoading("verify");
    setMessage(null);
    setDraft(null);
    try {
      const payload = buildCurrentVerifyPayload();
      const res = await verifyInvoice(payload, cfgLocal);
      if (!res.isOk) {
        setMessage({ type: "ko", texte: messageErreurKompto(res) });
        if (res.invoice) setDraft(res.invoice);
        return;
      }
      const ch = chainFromVerify(res.invoice);
      setDraft(res.invoice);
      setKomptoEntryId(String(ch.komptoEntryId));
      setKomptoItemId(String(ch.komptoItemId));
      setConfirmed(null);
      setMessage({ type: "ok", texte: `Brouillon vérifié — komptoEntryId ${ch.komptoEntryId} (total dû ${fmtComma(res.invoice.entryTotalDue)} FCFA). Vérifiez les montants puis Confirmez.` });

      // brouillon local pour archivage provisoire
      const totaux = totauxDecodes(res.invoice);
      const factureBrouillon = {
        numero: `FNE-BROUILLON-KOMPTO-${String(ch.komptoEntryId).slice(0, 6)}`,
        dateEmission: new Date().toISOString().slice(0, 10),
        certifie: false,
        lignes: (res.invoice.items || []).map((it) => ({
          designation: it.itemName,
          quantite: Number(it.itemQuantity),
          prixUnitaire: Number(it.itemUnitPrice),
          montantHT: parseMontantKompto(it.itemTotalPriceHT),
          tva: parseMontantKompto(it.itemTotalTVA),
          montantTTC: parseMontantKompto(it.itemTotalPriceTTC),
        })),
        montantHT: totaux.entryTotalPriceHT,
        tva: totaux.entryTotalTVA,
        montantTTC: totaux.entryTotalPriceTTC,
        komptoEntryId: ch.komptoEntryId,
      };
      setFactureActive(factureBrouillon);
    } catch (e) {
      setMessage({ type: "ko", texte: String(e.message || e) });
    } finally {
      setLoading(null);
    }
  };

  // ---------- Confirm ----------
  const handleConfirm = async () => {
    if (hasFneCol && fneStatutEffectif !== "active") {
      setMessage({
        type: "ko",
        texte:
          fneStatutEffectif === "expiree"
            ? "Option FNE expirée — renouvellement requis avant toute certification."
            : "Option FNE non active — la confirmation certifiée (/confirm) est bloquée.",
      });
      return;
    }
    const cfgLocal = {
      baseUrl: formulaire.kompto_base_url.trim() || cfg.baseUrl,
      apiKey: formulaire.kompto_api_key.trim() || cfg.apiKey,
    };
    const id = komptoEntryId || draft?.komptoEntryId;
    if (!id) {
      setMessage({ type: "ko", texte: "Aucun brouillon à confirmer. Lancez d'abord POST /verify." });
      return;
    }
    setLoading("confirm");
    setMessage(null);
    try {
      const payload = buildConfirmPayload({
        komptoEntryId: id,
        establishment: formulaire.kompto_etablissement.trim() || cfg.establishment,
        pointOfSale: formulaire.kompto_point_de_vente.trim() || cfg.pointOfSale,
        paymentMethod,
        isRNE,
        numberRNE: isRNE ? numberRNE : null,
        otherInfo: otherInfo || null,
        footer: footer || null,
      });
      const res = await confirmInvoice(payload, cfgLocal);
      if (!res.isOk) {
        setMessage({ type: "ko", texte: messageErreurKompto(res) });
        return;
      }
      const ch = chainFromConfirm(res.invoice);
      setConfirmed(res.invoice);
      setConfirmedEntryId(String(ch.confirmedEntryId));
      setNumberFNE(ch.numberFNE);
      setLinkFNE(ch.linkFNE);
      setCreditNoteItemId(String(ch.creditNoteItemId));
      setMessage({ type: "ok", texte: `Certifiée — numberFNE ${ch.numberFNE} (timbre ${fmtComma(res.invoice.entryTimbre)} FCFA, crédits restants ${res.invoice.stickerFNEbalance ?? "—"}).` });

      // archivage légal
      const totaux = totauxDecodes(res.invoice);
      const factureCertifiee = {
        numero: res.invoice.numberFNE,
        numberFNE: res.invoice.numberFNE,
        linkFNE: res.invoice.linkFNE,
        dateEmission: res.invoice.dateTimeFNE ? res.invoice.dateTimeFNE.slice(0, 10) : new Date().toISOString().slice(0, 10),
        dateTimeFNE: res.invoice.dateTimeFNE,
        certifie: true,
        lignes: (res.invoice.items || []).map((it) => ({
          designation: it.itemName,
          quantite: Number(it.itemQuantity),
          prixUnitaire: parseMontantKompto(it.itemUnitPrice),
          montantHT: parseMontantKompto(it.itemTotalPriceHT),
          tva: parseMontantKompto(it.itemTotalTVA),
          montantTTC: parseMontantKompto(it.itemTotalPriceTTC),
        })),
        montantHT: totaux.entryTotalPriceHT,
        tva: totaux.entryTotalTVA,
        montantTTC: totaux.entryTotalPriceTTC,
        entryTimbre: totaux.entryTimbre,
        entryTotalDue: totaux.entryTotalDue,
        typeFNE: res.invoice.typeFNE,
      };
      setFactureActive(factureCertifiee);
      // persistance
      const vente = ventesRecentes[0] || { id: null };
      await archiverFacture({ etablissement, vente, facture: factureCertifiee, transmission: { ok: true, donnees: res.invoice } });
      setFactures(await chargerFactures(etablissement.id));
      // le brouillon n'existe plus côté KOMPTO
      setDraft(null);
      setKomptoEntryId("");
      setKomptoItemId("");
    } catch (e) {
      setMessage({ type: "ko", texte: String(e.message || e) });
    } finally {
      setLoading(null);
    }
  };

  // ---------- Create (Path B) ----------
  const handleCreate = async () => {
    if (hasFneCol && fneStatutEffectif !== "active") {
      setMessage({ type: "ko", texte: "Option FNE non active — la création certifiée (/create) est bloquée. Activez l’option ou renouvelez." });
      return;
    }
    const cfgLocal = {
      baseUrl: formulaire.kompto_base_url.trim() || cfg.baseUrl,
      apiKey: formulaire.kompto_api_key.trim() || cfg.apiKey,
    };
    if (!cfgLocal.apiKey) {
      setMessage({ type: "ko", texte: "Clé API vide — Path B exige une clé." });
      return;
    }
    setLoading("create");
    setMessage(null);
    try {
      const verifyPart = buildCurrentVerifyPayload();
      const payload = {
        ...verifyPart,
        establishment: formulaire.kompto_etablissement.trim() || cfg.establishment,
        pointOfSale: formulaire.kompto_point_de_vente.trim() || cfg.pointOfSale,
        paymentMethod,
        isRNE,
        numberRNE: isRNE ? numberRNE : null,
        otherInfo: otherInfo || null,
        footer: footer || null,
      };
      const res = await createInvoice(payload, cfgLocal);
      if (!res.isOk) {
        setMessage({ type: "ko", texte: messageErreurKompto(res) });
        return;
      }
      const ch = chainFromConfirm(res.invoice);
      setConfirmed(res.invoice);
      setConfirmedEntryId(String(ch.confirmedEntryId));
      setNumberFNE(ch.numberFNE);
      setLinkFNE(ch.linkFNE);
      setCreditNoteItemId(String(ch.creditNoteItemId));
      setMessage({ type: "ok", texte: `Créée & certifiée en 1 appel — numberFNE ${ch.numberFNE}` });
      const totaux = totauxDecodes(res.invoice);
      const factureCertifiee = {
        numero: res.invoice.numberFNE,
        numberFNE: res.invoice.numberFNE,
        linkFNE: res.invoice.linkFNE,
        dateEmission: res.invoice.dateTimeFNE ? res.invoice.dateTimeFNE.slice(0, 10) : new Date().toISOString().slice(0, 10),
        certifie: true,
        lignes: (res.invoice.items || []).map((it) => ({
          designation: it.itemName,
          quantite: Number(it.itemQuantity),
          prixUnitaire: parseMontantKompto(it.itemUnitPrice),
          montantHT: parseMontantKompto(it.itemTotalPriceHT),
          tva: parseMontantKompto(it.itemTotalTVA),
          montantTTC: parseMontantKompto(it.itemTotalPriceTTC),
        })),
        montantHT: totaux.entryTotalPriceHT,
        tva: totaux.entryTotalTVA,
        montantTTC: totaux.entryTotalPriceTTC,
        entryTimbre: totaux.entryTimbre,
      };
      setFactureActive(factureCertifiee);
      const vente = ventesRecentes[0] || { id: null };
      await archiverFacture({ etablissement, vente, facture: factureCertifiee, transmission: { ok: true, donnees: res.invoice } });
      setFactures(await chargerFactures(etablissement.id));
    } catch (e) {
      setMessage({ type: "ko", texte: String(e.message || e) });
    } finally {
      setLoading(null);
    }
  };

  // ---------- Legacy brouillon depuis vente ----------
  const genererFactureLegacy = async (vente) => {
    if (!etablissement?.id) return;
    setGenerationEnCours(vente.id || "manuel");
    setMessage(null);
    try {
      const facture = construireFacture({ vente, etablissement, sequence: (factures?.length || 0) + 1 });
      // si KOMPTO est configuré, on passe par transmettreFacture (verify+confirm)
      const hasKompto = Boolean((formulaire.kompto_api_key.trim() || cfg.apiKey) && faturaIsKomptoReady());
      let transmission;
      if (hasKompto) {
        // bricolage : on réutilise handleVerify/handleConfirm en direct
        transmission = { ok: false, mode: "brouillon", erreur: "api_non_configuree" };
        // on fait un verify avec la vente comme unique ligne
        const payload = buildVerifyPayload({
          clientType: "B2B",
          clientName: client.clientName,
          clientNCC: client.clientNCC,
          clientTelephone: client.clientTelephone,
          clientEmail: client.clientEmail,
          foreignCurrencyName: null,
          exchangeRateCFAtoFX: null,
          entryTaxTTC1Name: null,
          entryTaxTTC1Percent: null,
          entryTaxTTC2Name: null,
          entryTaxTTC2Percent: null,
          items: [
            {
              itemName: vente.designation || "Vente",
              itemReference: null,
              itemUnitOfMeasure: "Unit",
              itemQuantity: Number(vente.quantite) || 1,
              itemUnitPrice: Number(vente.prixUnitaire) || Number(vente.montant) || 0,
              itemDiscountPercent: null,
              itemTVAName: "TVA",
              itemTaxTTC1Name: null,
              itemTaxTTC1Percent: null,
              itemTaxTTC2Name: null,
              itemTaxTTC2Percent: null,
            },
          ],
        });
        const cfgLocal = { baseUrl: formulaire.kompto_base_url.trim() || cfg.baseUrl, apiKey: formulaire.kompto_api_key.trim() || cfg.apiKey };
        const vRes = await verifyInvoice(payload, cfgLocal);
        if (vRes.isOk) {
          const cPayload = buildConfirmPayload({
            komptoEntryId: vRes.invoice.komptoEntryId,
            establishment: formulaire.kompto_etablissement.trim() || cfg.establishment,
            pointOfSale: formulaire.kompto_point_de_vente.trim() || cfg.pointOfSale,
            paymentMethod,
            isRNE,
            numberRNE: isRNE ? numberRNE : null,
            otherInfo: null,
            footer: null,
          });
          const cRes = await confirmInvoice(cPayload, cfgLocal);
          if (cRes.isOk) transmission = { ok: true, mode: "certifie", donnees: cRes.invoice };
          else transmission = { ok: false, mode: "certifie", erreur: messageErreurKompto(cRes) };
        } else {
          transmission = { ok: false, mode: "certifie", erreur: messageErreurKompto(vRes) };
        }
      } else {
        // fallback local : brouillon (pas de clé KOMPTO)
        transmission = { ok: false, mode: "brouillon", erreur: "api_non_configuree" };
      }
      const archive = await archiverFacture({ etablissement, vente, facture, transmission });
      const numeroDgi = transmission?.donnees?.numberFNE || transmission?.donnees?.numero;
      const factureFinale = numeroDgi ? { ...facture, numero: numeroDgi, certifie: true, numberFNE: numeroDgi } : facture;
      setFactureActive({ ...factureFinale, vente });
      if (transmission.ok) setMessage({ type: "ok", texte: t("fne_transmise_ok") });
      else if (transmission.erreur === "api_non_configuree") setMessage({ type: "info", texte: t("fne_brouillon_ok") });
      else setMessage({ type: "ko", texte: transmission.erreur || t("fne_transmission_ko") });
      setFactures(await chargerFactures(etablissement.id));
      if (!archive.ok) console.warn("FNE — archivage impossible :", archive.erreur);
    } catch (e) {
      console.error("FNE — génération :", e);
      setMessage({ type: "ko", texte: t("fne_erreur_generation") });
    } finally {
      setGenerationEnCours(null);
    }
  };

  function faturaIsKomptoReady() {
    return Boolean((formulaire.kompto_api_key.trim() || cfg.apiKey) && (formulaire.kompto_etablissement.trim() || cfg.establishment) && (formulaire.kompto_point_de_vente.trim() || cfg.pointOfSale));
  }

  // ---------- Lookup ----------
  const handleLookup = async () => {
    if (!lookupId) return;
    const cfgLocal = { baseUrl: formulaire.kompto_base_url.trim() || cfg.baseUrl, apiKey: formulaire.kompto_api_key.trim() || cfg.apiKey };
    if (!cfgLocal.apiKey) {
      setMessage({ type: "ko", texte: "Clé API vide." });
      return;
    }
    setLoading("lookup");
    setLookupResult(null);
    try {
      const fn = lookupMode === "getVerify" ? getVerify : getElectronicInvoice;
      const res = await fn(lookupId, cfgLocal);
      if (!res.isOk) {
        setMessage({ type: "ko", texte: messageErreurKompto(res) });
        setLookupResult({ error: messageErreurKompto(res), raw: res.body, status: res.status });
        return;
      }
      setLookupResult({ invoice: res.invoice, status: res.status });
      setMessage({ type: "ok", texte: `Trouvé — ${res.invoice.numberFNE || "brouillon"} · total dû ${fmtComma(res.invoice.entryTotalDue)} FCFA` });
    } catch (e) {
      setMessage({ type: "ko", texte: String(e.message || e) });
    } finally {
      setLoading(null);
    }
  };

  // ---------- Delete ----------
  const handleDelete = async () => {
    const id = komptoEntryId || draft?.komptoEntryId;
    if (!id) {
      setMessage({ type: "ko", texte: "Aucun brouillon à supprimer." });
      return;
    }
    const cfgLocal = { baseUrl: formulaire.kompto_base_url.trim() || cfg.baseUrl, apiKey: formulaire.kompto_api_key.trim() || cfg.apiKey };
    setLoading("delete");
    try {
      const res = await deleteDraft(id, cfgLocal);
      if (!res.isOk) {
        setMessage({ type: "ko", texte: messageErreurKompto(res) });
        return;
      }
      setMessage({ type: "ok", texte: res.body?.message || "Brouillon supprimé." });
      setDraft(null);
      setKomptoEntryId("");
      setKomptoItemId("");
    } catch (e) {
      setMessage({ type: "ko", texte: String(e.message || e) });
    } finally {
      setLoading(null);
    }
  };

  // ---------- Credit note ----------
  const handleCredit = async () => {
    const parentId = confirmedEntryId || confirmed?.komptoEntryId;
    const itemId = creditNoteItemId || confirmed?.items?.[0]?.komptoItemId;
    if (!parentId || !itemId) {
      setMessage({ type: "ko", texte: "Aucune facture certifiée + ligne à créditer. Confirmez d'abord une facture." });
      return;
    }
    const cfgLocal = { baseUrl: formulaire.kompto_base_url.trim() || cfg.baseUrl, apiKey: formulaire.kompto_api_key.trim() || cfg.apiKey };
    setLoading("credit");
    try {
      const res = await createCreditNote({ komptoEntryId: parentId, items: [{ komptoItemId: itemId, itemQuantity: Number(avoirQuantite) || 1 }] }, cfgLocal);
      if (!res.isOk) {
        setMessage({ type: "ko", texte: messageErreurKompto(res) });
        return;
      }
      setMessage({ type: "ok", texte: `Avoir ${res.invoice.numberFNE} émis — montant ${fmtComma(res.invoice.entryTotalDue)} FCFA (crédite ${parentId})` });
      // archive l'avoir comme facture de type Credit Note
      const avoirFacture = {
        numero: res.invoice.numberFNE,
        numberFNE: res.invoice.numberFNE,
        linkFNE: res.invoice.linkFNE,
        dateEmission: res.invoice.dateTimeFNE ? res.invoice.dateTimeFNE.slice(0, 10) : new Date().toISOString().slice(0, 10),
        certifie: true,
        lignes: (res.invoice.items || []).map((it) => ({
          designation: it.itemName,
          quantite: Number(it.itemQuantity),
          prixUnitaire: parseMontantKompto(it.itemUnitPrice),
          montantHT: parseMontantKompto(it.itemTotalPriceHT),
          tva: parseMontantKompto(it.itemTotalTVA),
          montantTTC: parseMontantKompto(it.itemTotalPriceTTC),
        })),
        montantHT: parseMontantKompto(res.invoice.entryTotalPriceDiscountedHT),
        tva: parseMontantKompto(res.invoice.entryTotalTVA),
        montantTTC: parseMontantKompto(res.invoice.entryTotalPriceTTC),
        typeFNE: "Credit Note",
      };
      await archiverFacture({ etablissement, vente: null, facture: avoirFacture, transmission: { ok: true, donnees: res.invoice } });
      setFactures(await chargerFactures(etablissement.id));
      setFactureActive({ ...avoirFacture, avoirDe: parentId });
    } catch (e) {
      setMessage({ type: "ko", texte: String(e.message || e) });
    } finally {
      setLoading(null);
    }
  };

  // ---------- Items helpers ----------
  const addItem = () =>
    setItems((prev) => [
      ...prev,
      {
        id: Math.max(...prev.map((p) => p.id), 0) + 1,
        itemName: "",
        itemReference: "",
        itemUnitOfMeasure: "Unit",
        itemQuantity: 1,
        itemUnitPrice: 0,
        itemDiscountPercent: "",
        itemTVAName: "TVA",
        itemTaxTTC1Name: "",
        itemTaxTTC1Percent: "",
        itemTaxTTC2Name: "",
        itemTaxTTC2Percent: "",
      },
    ]);
  const updateItem = (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));

  const remplirDepuisVente = (vente) => {
    if (!vente) return;
    setItems([
      {
        id: 1,
        itemName: vente.designation || "Vente",
        itemReference: "",
        itemUnitOfMeasure: "Unit",
        itemQuantity: Number(vente.quantite) || 1,
        itemUnitPrice: Number(vente.prixUnitaire) || Number(vente.montant) || 0,
        itemDiscountPercent: "",
        itemTVAName: "TVA",
        itemTaxTTC1Name: "",
        itemTaxTTC1Percent: "",
        itemTaxTTC2Name: "",
        itemTaxTTC2Percent: "",
      },
    ]);
    setMessage({ type: "info", texte: `Ligne préremplie depuis vente du ${vente.date} — ${fmt(vente.montant)} FCFA` });
  };

  const imprimerFacture = (f) => {
    const fenetre = window.open("", "_blank", "width=760,height=900");
    if (!fenetre) return;
    const actif = f.numberFNE || f.numero;
    const qr = f.linkFNE ? urlQrKompto(f) : urlQrVerification(actif);
    const corps = texteFacture({ etablissement, facture: f, certifie: Boolean(f.certifie || f.numberFNE) }).replace(/</g, "&lt;");
    fenetre.document.write(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${t("fne_titre")} — ${actif}</title>` +
        `<style>body{font-family:'Courier New',monospace;color:var(--cc-accent);padding:32px;font-size:13px;line-height:1.5}` +
        `pre{white-space:pre-wrap;font-family:'Courier New',monospace;font-size:12.5px}` +
        `img{margin-top:12px}</style></head><body><pre>${corps}</pre>` +
        (qr ? `<img src="${qr}" alt="QR de vérification" width="150" height="150" />` : "") +
        `</body></html>`
    );
    fenetre.document.close();
    fenetre.focus();
    fenetre.print();
  };
  const partagerFacture = (f) => {
    const texte = texteFacture({ etablissement, facture: f, certifie: Boolean(f.certifie || f.numberFNE) });
    window.open(`https://wa.me/?text=${encodeURIComponent(texte)}`, "_blank", "noopener,noreferrer");
  };

  if (!aAcces) {
    // FNE option gates (prioritaire) ; fallback legacy si migration absente → ancien message Pro
    if (hasFneCol && estSansFne) {
      return (
        <div className="cc-page cc-page-fne" style={S.page}>
          <div style={S.cadreCard} className="cc-card">
            <ShieldCheck size={18} color="var(--cc-or)" />
            <div>
              <div style={S.cadreTitre}>Option FNE — 100 000 FCFA/an par établissement</div>
              <p style={S.cadreTexte}>
                La facture normalisée électronique (DGI) est une option payante séparée, disponible sur tous les plans (Fondateur 7 000, Pro 10 000, Entreprise 20 000 inchangés). Sans cette option, vos factures restent des brouillons non certifiés.
              </p>
            </div>
          </div>
          <PaiementFNE etablissement={etablissement} t={t} onPaye={onRafraichirEtablissement} />
          <div style={S.verrouCard} className="cc-card">
            <Lock size={18} color="var(--cc-texte-doux)" />
            <div>
              <div style={S.verrouTitre}>Sans FNE : compta normale</div>
              <p style={S.verrouTexte}>Vous pouvez continuer à utiliser ComptaCi en compta interne (sans certification). Pour activer la certification DGI via KOMPTO, réglez l'option ci-dessus puis connectez votre établissement dans l'onglet Enrôlement.</p>
            </div>
          </div>
        </div>
      );
    }
    if (hasFneCol && estEnCours) {
      return (
        <div className="cc-page cc-page-fne" style={S.page}>
          <div style={{ ...S.verrouCard, borderColor: "var(--cc-or-pale)", background: "var(--cc-surface-3)" }} className="cc-card">
            <CheckCircle size={22} color="var(--cc-or)" />
            <div>
              <div style={S.verrouTitre}>Paiement FNE reçu — en attente de connexion KOMPTO</div>
              <p style={S.verrouTexte}>Votre option est payée (statut <strong>en_cours</strong>, échéance {fneExpiration ? new Date(fneExpiration).toLocaleDateString("fr-FR") : "—"}). Renseignez maintenant votre clé API KOMPTO, establishment, pointOfSale et NCC dans <strong>Abonnement → Option FNE</strong> (ou ci-dessous en rechargeant) pour passer en <em>active</em>.</p>
            </div>
          </div>
          <div style={S.card} className="cc-card">
            <div style={S.cardTitle}>Que faire ?</div>
            <ol style={S.etapes}>
              <li>Ouvrez <strong>Abonnement → Option FNE</strong> (ou rechargez cette page après paiement).</li>
              <li>Collez la clé API KOMPTO (UUID) liée à votre NCC, puis votre establishment / pointOfSale exacts (sensibles à la casse, ex: PROGICI SARL / SIEGE en sandbox).</li>
              <li>« Tester la clé » puis « Enregistrer » — vous passez automatiquement en <em>active</em>.</li>
            </ol>
            <button type="button" onClick={() => onRafraichirEtablissement?.()} style={S.btnSecondaire}>Recharger l'établissement</button>
          </div>
        </div>
      );
    }
    if (hasFneCol && estExpiree) {
      return (
        <div className="cc-page cc-page-fne" style={S.page}>
          <div style={{ ...S.verrouCard, borderColor: "var(--cc-rouge-bord)", background: "var(--cc-rouge-fond)" }} className="cc-card">
            <XCircle size={22} color="var(--cc-rouge)" />
            <div>
              <div style={S.verrouTitre}>Option FNE expirée — certification coupée</div>
              <p style={S.verrouTexte}>Échéance dépassée {fneExpiration ? `(${new Date(fneExpiration).toLocaleDateString("fr-FR")})` : ""}. Les factures ne peuvent plus être certifiées tant que l'option n'est pas renouvelée (100 000 FCFA/an).</p>
            </div>
          </div>
          <PaiementFNE etablissement={etablissement} t={t} onPaye={onRafraichirEtablissement} />
        </div>
      );
    }
    // fallback legacy (migration non appliquée)
    return (
      <div className="cc-page cc-page-fne" style={S.page}>
        <div style={S.verrouCard} className="cc-card">
          <Lock size={22} color="var(--cc-or)" />
          <div>
            <div style={S.verrouTitre}>{t("fne_reserve_pro")}</div>
            <p style={S.verrouTexte}>{t("fne_reserve_pro_texte")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-page cc-page-fne" style={S.page}>
      <div style={S.cadreCard} className="cc-card">
        <ShieldCheck size={18} color="var(--cc-vert)" />
        <div>
          <div style={S.cadreTitre}>{t("fne_cadre_titre")} — {fneStatutEffectif === "active" ? "active" : fneStatutEffectif}</div>
          <p style={S.cadreTexte}>{t("fne_cadre_texte")}</p>
          <p style={{ ...S.cadreTexte, marginTop: 6, fontSize: 11.5, opacity: 0.85 }}>
            KOMPTO sandbox : <code style={S.codeInline}>https://qa.kompto.com</code> — factures émises au nom de <strong>PROGICI SARL / SIEGE</strong> sans valeur fiscale. Collection Postman :{" "}
            <code style={S.codeInline}>postman/KOMPTO-Sandbox.postman_collection.json</code>
            {hasFneCol && fneExpiration ? ` · Échéance FNE : ${new Date(fneExpiration).toLocaleDateString("fr-FR")} · statut : ${fneStatutEffectif}` : ""}
          </p>
        </div>
      </div>
      {hasFneCol && fneExpiration && fneStatutEffectif === "active" && (() => {
        const jours = Math.ceil((new Date(fneExpiration) - new Date()) / 86400000);
        if (jours < 0) return null;
        if (jours <= 30) return (
          <div style={{ ...S.message, ...(jours <= 7 ? S.messageKo : S.messageInfo) }}>
            {jours <= 7 ? "⚠️" : "ℹ️"} Option FNE — échéance dans {jours} jour{jours > 1 ? "s" : ""} ({new Date(fneExpiration).toLocaleDateString("fr-FR")}). Renouvellement : 100 000 FCFA/an via le lien SasPay FNE.
          </div>
        );
        return null;
      })()}

      <div style={S.onglets}>
        <button type="button" onClick={() => setOnglet("enrolement")} style={{ ...S.onglet, ...(onglet === "enrolement" ? S.ongletActif : {}) }}>
          <Settings2 size={14} /> {t("fne_onglet_enrolement")} — KOMPTO
        </button>
        <button type="button" onClick={() => setOnglet("facturation")} style={{ ...S.onglet, ...(onglet === "facturation" ? S.ongletActif : {}) }}>
          <FileText size={14} /> Facturer (KOMPTO)
        </button>
        <button type="button" onClick={() => setOnglet("generation")} style={{ ...S.onglet, ...(onglet === "generation" ? S.ongletActif : {}) }}>
          <RefreshCw size={14} /> Ventes rapides
        </button>
        <button type="button" onClick={() => setOnglet("archive")} style={{ ...S.onglet, ...(onglet === "archive" ? S.ongletActif : {}) }}>
          <Copy size={14} /> {t("fne_onglet_archive")} ({factures.length})
        </button>
      </div>

      {message && (
        <div style={{ ...S.message, ...(message.type === "ok" ? S.messageOk : message.type === "ko" ? S.messageKo : S.messageInfo) }}>
          {message.texte}
        </div>
      )}

      {/* ------------------------------- ENROLEMENT KOMPTO ------------------------------- */}
      {onglet === "enrolement" && (
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>Enrôlement KOMPTO / DGI</div>
              <div style={S.cardCaption}>Clé API, établissement et point de vente — sandbox vs production</div>
            </div>
            <span
              style={{
                ...S.statutBadge,
                background: etat.pretPourApi ? "var(--cc-vert-fond)" : etat.enrole ? "var(--cc-surface-3)" : "var(--cc-rouge-fond)",
                color: etat.pretPourApi ? "var(--cc-vert)" : etat.enrole ? "var(--cc-or-clair)" : "var(--cc-rouge)",
              }}
            >
              {etat.pretPourApi ? t("fne_statut_certifie") : etat.enrole ? t("fne_statut_partiel") : t("fne_statut_brouillon")}
            </span>
          </div>

          <div style={S.noticeKompto}>
            <div style={S.noticeTitre}>
              <AlertTriangle size={14} /> Sandbox partagé
            </div>
            <p style={S.noticeTexte}>
              En sandbox KOMPTO, les factures sont toujours émises au nom de <strong>PROGICI SARL / SIEGE</strong>. C'est normal. En production, basculez{" "}
              <code style={S.codeInline}>baseUrl</code> vers l'hôte prod fourni par KOMPTO, utilisez votre clé prod et renseignez votre propre{" "}
              <code style={S.codeInline}>establishment</code> / <code style={S.codeInline}>pointOfSale</code> (sensible à la casse, caractère pour caractère).
            </p>
          </div>

          <ol style={S.etapes}>
            <li>Faites enrôler l'établissement sur la plateforme FNE (numéro de contribuable + RCCM).</li>
            <li>Récupérez la clé API KOMPTO (UUID) liée à votre establishment / pointOfSale.</li>
            <li>Collez-la ci-dessous : chaque vente pourra devenir une FNE certifiée (numéro normé, sticker, QR).</li>
          </ol>

          <div style={S.form}>
            <label style={S.field}>
              <span style={S.label}>Clé API KOMPTO (Bearer) — sandbox ou prod</span>
              <input
                type="password"
                value={formulaire.kompto_api_key}
                onChange={(e) => setFormulaire({ ...formulaire, kompto_api_key: e.target.value })}
                placeholder="UUID KOMPTO, ex: 123e4567-e89b-12d3-a456-426614174000"
                style={S.input}
                autoComplete="off"
              />
              <span style={S.hint}>En-tête envoyé : Authorization: Bearer {"{{apiKey}}"}. Jamais dans le body, jamais commitée.</span>
            </label>
            <div style={S.twoCol}>
              <label style={S.field}>
                <span style={S.label}>baseUrl KOMPTO</span>
                <input
                  type="text"
                  value={formulaire.kompto_base_url}
                  onChange={(e) => setFormulaire({ ...formulaire, kompto_base_url: e.target.value })}
                  placeholder="https://qa.kompto.com"
                  style={S.input}
                />
                <span style={S.hint}>Sandbox : https://qa.kompto.com — Prod : host fourni par KOMPTO</span>
              </label>
              <button type="button" onClick={testerCle} disabled={testCle.loading} style={S.btnSecondaire}>
                {testCle.loading ? "Test…" : "Tester la clé"}
              </button>
            </div>
            {testCle.result && (
              <div style={{ ...S.message, ...(testCle.result.ok ? S.messageOk : S.messageKo), marginTop: 0 }}>
                <strong>{testCle.result.ok ? "Clé OK" : "Échec"}</strong> — {testCle.result.message}
              </div>
            )}

            <div style={S.twoCol}>
              <label style={S.field}>
                <span style={S.label}>establishment (DGI) — sensible à la casse</span>
                <input
                  type="text"
                  value={formulaire.kompto_etablissement}
                  onChange={(e) => setFormulaire({ ...formulaire, kompto_etablissement: e.target.value })}
                  placeholder="PROGICI SARL"
                  style={S.input}
                />
              </label>
              <label style={S.field}>
                <span style={S.label}>pointOfSale — sensible à la casse</span>
                <input
                  type="text"
                  value={formulaire.kompto_point_de_vente}
                  onChange={(e) => setFormulaire({ ...formulaire, kompto_point_de_vente: e.target.value })}
                  placeholder="SIEGE"
                  style={S.input}
                />
              </label>
            </div>

            <details style={S.details}>
              <summary style={S.detailsSummary}>Legacy DGI direct (fne_numero_contribuable / RCCM) — conservé pour compatibilité</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                <label style={S.field}>
                  <span style={S.label}>{t("fne_numero_contribuable")}</span>
                  <input
                    type="text"
                    value={formulaire.fne_numero_contribuable}
                    onChange={(e) => setFormulaire({ ...formulaire, fne_numero_contribuable: e.target.value })}
                    placeholder={t("fne_numero_contribuable_placeholder")}
                    style={S.input}
                  />
                </label>
                <label style={S.field}>
                  <span style={S.label}>{t("fne_rccm")}</span>
                  <input
                    type="text"
                    value={formulaire.fne_rccm}
                    onChange={(e) => setFormulaire({ ...formulaire, fne_rccm: e.target.value })}
                    placeholder={t("fne_rccm_placeholder")}
                    style={S.input}
                  />
                </label>
              </div>
            </details>

            <button type="button" onClick={enregistrerEnrolement} disabled={enregistrement} style={S.btnPrimaire}>
              {enregistrement ? t("fne_enregistrement") : t("fne_enregistrer")}
            </button>
          </div>

          <div style={S.avertissement}>
            <AlertTriangle size={15} />
            <p style={S.avertissementTexte}>
              Sans clé API, ComptaCi génère des BROUILLONS avec numéro provisoire (ex: FNE-BROUILLON-…). Ils ne remplacent pas une facture DGI certifiée. Avec{" "}
              <code style={S.codeInline}>paymentMethod: cash</code>, la DGI ajoute un timbre (0 → 5000 FCFA selon le barème) : le total certifié dépassera le total vérifié.
            </p>
          </div>

          {/* Chaining actuel */}
          {(komptoEntryId || confirmedEntryId || numberFNE) && (
            <div style={S.chainBox}>
              <div style={S.chainTitle}>Variable chaining (Postman)</div>
              <div style={S.chainGrid}>
                <span style={S.chainLabel}>komptoEntryId</span>
                <code style={S.chainValue}>{komptoEntryId || "—"}</code>
                <span style={S.chainLabel}>komptoItemId</span>
                <code style={S.chainValue}>{komptoItemId || "—"}</code>
                <span style={S.chainLabel}>confirmedEntryId</span>
                <code style={S.chainValue}>{confirmedEntryId || "—"}</code>
                <span style={S.chainLabel}>numberFNE</span>
                <code style={S.chainValue}>{numberFNE || "—"}</code>
                <span style={S.chainLabel}>linkFNE</span>
                <code style={{ ...S.chainValue, wordBreak: "break-all" }}>{linkFNE || "—"}</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------- FACTURATION KOMPTO ------------------------------- */}
      {onglet === "facturation" && (
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>Facturer via KOMPTO — Path A (verify → confirm) & Path B (create)</div>
              <div style={S.cardCaption}>Recommandé en intégration : vérifiez, montrez les montants, puis confirmez. Path B en 1 appel quand les montants sont sûrs.</div>
            </div>
            <span style={{ ...S.statutBadge, background: etat.pretPourApi ? "var(--cc-vert-fond)" : "var(--cc-rouge-fond)", color: etat.pretPourApi ? "var(--cc-vert)" : "var(--cc-rouge)" }}>
              {etat.pretPourApi ? "Prêt KOMPTO" : "Clé manquante → brouillon"}
            </span>
          </div>

          {/* Client */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Client</div>
            <div style={S.twoCol}>
              <label style={S.field}>
                <span style={S.label}>clientType</span>
                <select value={client.clientType} onChange={(e) => setClient({ ...client, clientType: e.target.value })} style={S.input}>
                  {CLIENT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>
                      {ct}
                    </option>
                  ))}
                </select>
              </label>
              <label style={S.field}>
                <span style={S.label}>clientName (255 max)</span>
                <input type="text" value={client.clientName} onChange={(e) => setClient({ ...client, clientName: e.target.value })} style={S.input} />
              </label>
            </div>
            <div style={S.twoCol}>
              <label style={S.field}>
                <span style={S.label}>clientNCC {client.clientType === "B2B" ? "(7 chiffres + 1 majuscule, B2B)" : "(null pour B2C/B2G/B2F)"}</span>
                <input
                  type="text"
                  value={client.clientNCC}
                  onChange={(e) => setClient({ ...client, clientNCC: e.target.value })}
                  placeholder={client.clientType === "B2B" ? "8200001A" : "null"}
                  style={{ ...S.input, ...(client.clientType === "B2B" && client.clientNCC && !/^[0-9]{7}[A-Z]$/.test(client.clientNCC) ? S.inputError : {}) }}
                />
              </label>
              <label style={S.field}>
                <span style={S.label}>clientTelephone</span>
                <input type="text" value={client.clientTelephone} onChange={(e) => setClient({ ...client, clientTelephone: e.target.value })} style={S.input} placeholder="2721212121 (ou +336... pour B2F)" />
              </label>
            </div>
            <label style={S.field}>
              <span style={S.label}>clientEmail</span>
              <input type="email" value={client.clientEmail} onChange={(e) => setClient({ ...client, clientEmail: e.target.value })} style={S.input} />
            </label>
            {client.clientType === "B2F" && (
              <div style={S.twoCol}>
                <label style={S.field}>
                  <span style={S.label}>foreignCurrencyName (B2F)</span>
                  <input type="text" value={client.foreignCurrencyName} onChange={(e) => setClient({ ...client, foreignCurrencyName: e.target.value })} style={S.input} placeholder="EUR" />
                </label>
                <label style={S.field}>
                  <span style={S.label}>exchangeRateCFAtoFX (ex: 655.957 — dot)</span>
                  <input type="number" step="any" value={client.exchangeRateCFAtoFX} onChange={(e) => setClient({ ...client, exchangeRateCFAtoFX: e.target.value })} style={S.input} placeholder="655.957" />
                </label>
              </div>
            )}
            <div style={S.twoCol}>
              <label style={S.field}>
                <span style={S.label}>entryTaxTTC1 (optionnel — paire)</span>
                <div style={S.inlinePair}>
                  <input type="text" placeholder="Nom (ex: TSP)" value={entryTax1.name} onChange={(e) => setEntryTax1({ ...entryTax1, name: e.target.value })} style={{ ...S.input, flex: 1 }} />
                  <input type="number" step="any" placeholder="%" value={entryTax1.percent} onChange={(e) => setEntryTax1({ ...entryTax1, percent: e.target.value })} style={{ ...S.input, width: 110 }} />
                </div>
                <span style={S.hint}>Les deux ou rien — jamais 0.</span>
              </label>
              <label style={S.field}>
                <span style={S.label}>entryTaxTTC2 (optionnel — paire)</span>
                <div style={S.inlinePair}>
                  <input type="text" placeholder="Nom" value={entryTax2.name} onChange={(e) => setEntryTax2({ ...entryTax2, name: e.target.value })} style={{ ...S.input, flex: 1 }} />
                  <input type="number" step="any" placeholder="%" value={entryTax2.percent} onChange={(e) => setEntryTax2({ ...entryTax2, percent: e.target.value })} style={{ ...S.input, width: 110 }} />
                </div>
              </label>
            </div>
          </div>

          {/* Lignes */}
          <div style={S.section}>
            <div style={S.sectionHeaderRow}>
              <div style={S.sectionTitle}>Lignes (items) — au moins 1</div>
              <button type="button" onClick={addItem} style={S.btnPetit}>
                <Plus size={13} /> Ajouter une ligne
              </button>
            </div>
            <div style={S.hint}>Montants envoyés en <strong>numbers</strong> avec dot. Reçus en <strong>strings</strong> avec comma + %. TVA : TVA/TVAB/TVAC/TVAD/TVAE.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {items.map((it) => (
                <div key={it.id} style={S.itemCard}>
                  <div style={S.itemHeader}>
                    <span style={S.itemBadge}>#{it.id}</span>
                    <button type="button" onClick={() => removeItem(it.id)} style={S.btnIconDanger} title="Retirer">
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div style={S.twoCol}>
                    <label style={S.field}>
                      <span style={S.label}>itemName</span>
                      <input type="text" value={it.itemName} onChange={(e) => updateItem(it.id, { itemName: e.target.value })} style={S.input} placeholder="Désignation" />
                    </label>
                    <label style={S.field}>
                      <span style={S.label}>itemTVAName</span>
                      <select value={it.itemTVAName} onChange={(e) => updateItem(it.id, { itemTVAName: e.target.value })} style={S.input}>
                        {KOMPTO_TVA_CODES.map((code) => (
                          <option key={code} value={code}>
                            {TVA_LABELS[code]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div style={S.threeCol}>
                    <label style={S.field}>
                      <span style={S.label}>itemQuantity (&gt;0, dot)</span>
                      <input type="number" step="any" value={it.itemQuantity} onChange={(e) => updateItem(it.id, { itemQuantity: e.target.value })} style={S.input} />
                    </label>
                    <label style={S.field}>
                      <span style={S.label}>itemUnitPrice (&gt;0)</span>
                      <input type="number" step="any" value={it.itemUnitPrice} onChange={(e) => updateItem(it.id, { itemUnitPrice: e.target.value })} style={S.input} />
                    </label>
                    <label style={S.field}>
                      <span style={S.label}>itemDiscountPercent (0-100)</span>
                      <input type="number" step="any" value={it.itemDiscountPercent} onChange={(e) => updateItem(it.id, { itemDiscountPercent: e.target.value })} style={S.input} placeholder="null si aucun" />
                    </label>
                  </div>
                  <div style={S.twoCol}>
                    <label style={S.field}>
                      <span style={S.labelMini}>Ref / Unité (optionnel)</span>
                      <div style={S.inlinePair}>
                        <input type="text" placeholder="Réf" value={it.itemReference} onChange={(e) => updateItem(it.id, { itemReference: e.target.value })} style={{ ...S.input, flex: 1 }} />
                        <input type="text" placeholder="Unit/Box/Kg" value={it.itemUnitOfMeasure} onChange={(e) => updateItem(it.id, { itemUnitOfMeasure: e.target.value })} style={{ ...S.input, flex: 1 }} />
                      </div>
                    </label>
                    <label style={S.field}>
                      <span style={S.labelMini}>Taxes ligne TTC (paires — null/omitted si inutile, jamais 0)</span>
                      <div style={S.inlinePair}>
                        <input type="text" placeholder="TX1 nom" value={it.itemTaxTTC1Name} onChange={(e) => updateItem(it.id, { itemTaxTTC1Name: e.target.value })} style={{ ...S.input, flex: 1 }} />
                        <input type="number" step="any" placeholder="TX1 %" value={it.itemTaxTTC1Percent} onChange={(e) => updateItem(it.id, { itemTaxTTC1Percent: e.target.value })} style={{ ...S.input, width: 90 }} />
                        <input type="text" placeholder="TX2 nom" value={it.itemTaxTTC2Name} onChange={(e) => updateItem(it.id, { itemTaxTTC2Name: e.target.value })} style={{ ...S.input, flex: 1 }} />
                        <input type="number" step="any" placeholder="TX2 %" value={it.itemTaxTTC2Percent} onChange={(e) => updateItem(it.id, { itemTaxTTC2Percent: e.target.value })} style={{ ...S.input, width: 90 }} />
                      </div>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Paiement & RNE */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Paiement & certification</div>
            <div style={S.twoCol}>
              <label style={S.field}>
                <span style={S.label}>paymentMethod (confirm / create)</span>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={S.input}>
                  {KOMPTO_PAYMENT_METHODS.map((pm) => (
                    <option key={pm} value={pm}>
                      {pm} — {PAYMENT_LABELS[pm]}
                    </option>
                  ))}
                </select>
                <span style={S.hint}>cash → timbre DGI ajouté, autres → 0.</span>
              </label>
              <label style={S.field}>
                <span style={S.label}>isRNE / numberRNE</span>
                <div style={S.inlinePair}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" checked={isRNE} onChange={(e) => setIsRNE(e.target.checked)} /> isRNE
                  </label>
                  <input
                    type="text"
                    placeholder="Numéro RNE/TERNE si isRNE"
                    value={numberRNE}
                    onChange={(e) => setNumberRNE(e.target.value)}
                    style={{ ...S.input, flex: 1, opacity: isRNE ? 1 : 0.5 }}
                    disabled={!isRNE}
                  />
                </div>
              </label>
            </div>
            <div style={S.twoCol}>
              <label style={S.field}>
                <span style={S.label}>otherInfo (250 max, optionnel)</span>
                <input type="text" value={otherInfo} onChange={(e) => setOtherInfo(e.target.value)} style={S.input} placeholder="Info libre imprimée" maxLength={250} />
              </label>
              <label style={S.field}>
                <span style={S.label}>footer (250 max, optionnel)</span>
                <input type="text" value={footer} onChange={(e) => setFooter(e.target.value)} style={S.input} placeholder="Pied de page" maxLength={250} />
              </label>
            </div>
          </div>

          {/* Actions Path A / B */}
          <div style={S.actionsRow}>
            <button type="button" onClick={handleVerify} disabled={loading === "verify"} style={{ ...S.btnPrimaire, flex: 1 }}>
              {loading === "verify" ? "Vérification…" : "POST /verify — Vérifier (Path A, étape 1)"}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading === "confirm" || (!komptoEntryId && !draft?.komptoEntryId)}
              style={{ ...S.btnPrimaire, flex: 1, background: "var(--cc-vert)", opacity: !komptoEntryId && !draft?.komptoEntryId ? 0.5 : 1 }}
            >
              {loading === "confirm" ? "Confirmation…" : "POST /confirm — Certifier (Path A, étape 2)"}
            </button>
          </div>
          <button type="button" onClick={handleCreate} disabled={loading === "create"} style={{ ...S.btnSecondaire, width: "100%", marginTop: 8 }}>
            {loading === "create" ? "Création…" : "POST /create — Créer & certifier en 1 appel (Path B)"}
          </button>
          <div style={S.hint}>Path A recommandé pendant l'intégration : /verify vous rend komptoEntryId + montants calculés avant d'envoyer à la DGI. /create ne rend pas d'id si la DGI rejette.</div>

          {/* Aperçu draft / confirmed */}
          {(draft || confirmed) && (
            <div style={S.factureApercu}>
              {draft && !confirmed && (
                <>
                  <div style={S.apercuHeader}>
                    <strong>Brouillon vérifié (komptoEntryId {draft.komptoEntryId})</strong>
                    <span style={S.apercuBadgeBrouillon}>Pending — non certifié</span>
                  </div>
                  <div style={S.totauxGrid}>
                    <div style={S.totauxCell}>HT remisé: {fmtComma(draft.entryTotalPriceDiscountedHT)} FCFA</div>
                    <div style={S.totauxCell}>TVA: {fmtComma(draft.entryTotalTVA)} FCFA</div>
                    <div style={S.totauxCell}>Taxes TTC: {fmtComma(draft.entryTotalTaxesTTC)} FCFA</div>
                    <div style={S.totauxCell}>
                      <strong>TTC: {fmtComma(draft.entryTotalPriceTTC)} FCFA</strong>
                    </div>
                    <div style={S.totauxCell}>
                      <strong>Dû: {fmtComma(draft.entryTotalDue)} FCFA</strong>
                    </div>
                    {draft.foreignCurrencyName && <div style={S.totauxCell}>En {draft.foreignCurrencyName}: {fmtComma(draft.entryTotalDueFX)}</div>}
                  </div>
                  <div style={S.hint}>Attention : le timbre (cash) et le numberFNE n'apparaissent qu'après /confirm. Ne pas comptabiliser le brouillon.</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button type="button" onClick={handleDelete} disabled={loading === "delete"} style={S.btnPetitDanger}>
                      <Trash2 size={12} /> {loading === "delete" ? "Suppression…" : "DELETE /delete — Abandonner le brouillon"}
                    </button>
                    <button type="button" onClick={() => setLookupId(String(draft.komptoEntryId))} style={S.btnPetit}>
                      <Eye size={12} /> Préremplir lookup getVerify
                    </button>
                  </div>
                </>
              )}
              {confirmed && (
                <>
                  <div style={S.apercuHeader}>
                    <strong>Certifiée — {confirmed.numberFNE}</strong>
                    <span style={S.apercuBadgeOk}>Certifiée DGI</span>
                  </div>
                  <div style={S.totauxGrid}>
                    <div style={S.totauxCell}>HT remisé: {fmtComma(confirmed.entryTotalPriceDiscountedHT)} FCFA</div>
                    <div style={S.totauxCell}>TVA: {fmtComma(confirmed.entryTotalTVA)} FCFA</div>
                    <div style={S.totauxCell}>Taxes TTC: {fmtComma(confirmed.entryTotalTaxesTTC)} FCFA</div>
                    <div style={S.totauxCell}>Timbre: {fmtComma(confirmed.entryTimbre)} FCFA</div>
                    <div style={S.totauxCell}>
                      <strong>Dû: {fmtComma(confirmed.entryTotalDue)} FCFA</strong>
                    </div>
                    <div style={S.totauxCell}>Sticker restants: {confirmed.stickerFNEbalance ?? "—"}</div>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--cc-texte-doux)", marginTop: 4 }}>
                    {confirmed.dateTimeFNE} · {confirmed.typeFNE} · vendeur {confirmed.sellerNCC} ·{" "}
                    <a href={confirmed.linkFNE} target="_blank" rel="noopener noreferrer" style={S.lienVerif}>
                      Vérifier sur DGI <ExternalLink size={11} style={{ display: "inline" }} />
                    </a>
                  </div>
                  {confirmed.linkFNE && <img src={urlQrKompto(confirmed)} alt="QR DGI" width={120} height={120} style={{ marginTop: 8, border: "1px solid var(--cc-bord)", borderRadius: 8 }} />}
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() =>
                        imprimerFacture({
                          numero: confirmed.numberFNE,
                          numberFNE: confirmed.numberFNE,
                          linkFNE: confirmed.linkFNE,
                          dateEmission: confirmed.dateTimeFNE?.slice(0, 10),
                          certifie: true,
                          lignes: (confirmed.items || []).map((it) => ({
                            designation: it.itemName,
                            quantite: it.itemQuantity,
                            prixUnitaire: parseMontantKompto(it.itemUnitPrice),
                            montantHT: parseMontantKompto(it.itemTotalPriceHT),
                            tva: parseMontantKompto(it.itemTotalTVA),
                            montantTTC: parseMontantKompto(it.itemTotalPriceTTC),
                          })),
                          montantHT: parseMontantKompto(confirmed.entryTotalPriceDiscountedHT),
                          tva: parseMontantKompto(confirmed.entryTotalTVA),
                          montantTTC: parseMontantKompto(confirmed.entryTotalPriceTTC),
                        })
                      }
                      style={S.btnSecondaire}
                    >
                      <Printer size={14} /> Imprimer
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        partagerFacture({
                          numero: confirmed.numberFNE,
                          numberFNE: confirmed.numberFNE,
                          linkFNE: confirmed.linkFNE,
                          dateEmission: confirmed.dateTimeFNE?.slice(0, 10),
                          certifie: true,
                          lignes: (confirmed.items || []).map((it) => ({
                            designation: it.itemName,
                            quantite: it.itemQuantity,
                            prixUnitaire: parseMontantKompto(it.itemUnitPrice),
                            montantHT: parseMontantKompto(it.itemTotalPriceHT),
                            tva: parseMontantKompto(it.itemTotalTVA),
                            montantTTC: parseMontantKompto(it.itemTotalPriceTTC),
                          })),
                          montantHT: parseMontantKompto(confirmed.entryTotalPriceDiscountedHT),
                          tva: parseMontantKompto(confirmed.entryTotalTVA),
                          montantTTC: parseMontantKompto(confirmed.entryTotalPriceTTC),
                        })
                      }
                      style={S.btnSecondaire}
                    >
                      <MessageCircle size={14} /> WhatsApp
                    </button>
                  </div>
                  {/* Avoir */}
                  <div style={S.avoirBox}>
                    <div style={S.sectionTitle}>Avoir (credit note) — réduire une quantité</div>
                    <div style={S.hint}>Envoie uniquement komptoItemId + quantité. Prix/TVA hérités pro rata. komptoItemId = {creditNoteItemId || "—"}</div>
                    <div style={S.inlinePair}>
                      <input type="number" step="any" min="0" value={avoirQuantite} onChange={(e) => setAvoirQuantite(e.target.value)} style={{ ...S.input, width: 120 }} />
                      <button type="button" onClick={handleCredit} disabled={loading === "credit"} style={S.btnPetitDanger}>
                        <RotateCcw size={12} /> {loading === "credit" ? "Avoir…" : "POST /createCreditNote"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Lookup */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Lecture & statut (getters)</div>
            <div style={S.hint}>getVerify = brouillon (enveloppe value), getElectronicInvoice = certifiée (plat). 404 = bare string "La commande n'existe pas."</div>
            <div style={S.inlinePair}>
              <select value={lookupMode} onChange={(e) => setLookupMode(e.target.value)} style={{ ...S.input, width: 220 }}>
                <option value="getVerify">GET /getVerify (pending)</option>
                <option value="getElectronicInvoice">GET /getElectronicInvoice (certified)</option>
              </select>
              <input type="text" placeholder="komptoEntryId" value={lookupId} onChange={(e) => setLookupId(e.target.value)} style={{ ...S.input, flex: 1 }} />
              <button type="button" onClick={handleLookup} disabled={loading === "lookup"} style={S.btnSecondaire}>
                <Search size={14} /> {loading === "lookup" ? "…" : "Lire"}
              </button>
            </div>
            {lookupResult && (
              <pre style={S.preFacture}>{JSON.stringify(lookupResult, null, 2).slice(0, 4000)}</pre>
            )}
            <div style={{ ...S.hint, color: "var(--cc-rouge)" }}>⚠️ getVerify sur une facture déjà certifiée renvoie 200 avec les totaux pré-certification (sans timbre). Seule getElectronicInvoice fait foi après certification.</div>
          </div>

          {factureActive && (
            <div style={S.factureApercu}>
              <div style={S.cardHeader}>
                <div>
                  <div style={S.cardTitle}>{t("fne_apercu_titre")}</div>
                  <div style={S.cardCaption}>{factureActive.certifie ? t("fne_statut_certifie") : t("fne_statut_brouillon")}</div>
                </div>
              </div>
              <pre style={S.preFacture}>{texteFacture({ etablissement, facture: factureActive, certifie: Boolean(factureActive.certifie) })}</pre>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------- VENTES RAPIDES ------------------------------- */}
      {onglet === "generation" && (
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("fne_generation_titre")}</div>
              <div style={S.cardCaption}>{t("fne_generation_sous")} — raccourci 1-clic (B2B par défaut, TVA 18%)</div>
            </div>
          </div>
          <div style={S.hint}>Cliquez sur une vente pour préremplir l'onglet Facturer, ou générez directement un brouillon.</div>
          {ventesRecentes.length === 0 ? (
            <div style={S.vide}>{t("fne_aucune_vente")}</div>
          ) : (
            <div style={S.listeVentes}>
              {ventesRecentes.map((v) => (
                <div key={v.id} style={S.ligneVente}>
                  <div>
                    <div style={S.venteDesignation}>{v.designation || t("fne_vente_sans_nom")}</div>
                    <div style={S.venteMeta}>
                      {v.date} · {fmt(v.montant)} FCFA
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => remplirDepuisVente(v)} style={S.btnPetit}>
                      Préremplir
                    </button>
                    <button type="button" onClick={() => genererFactureLegacy(v)} disabled={generationEnCours === (v.id || "manuel")} style={S.btnPetit}>
                      {generationEnCours === (v.id || "manuel") ? t("fne_generation_encours") : t("fne_generer")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {factureActive && (
            <div style={S.factureApercu}>
              <div style={S.cardHeader}>
                <div>
                  <div style={S.cardTitle}>{t("fne_apercu_titre")}</div>
                  <div style={S.cardCaption}>{factureActive.certifie ? t("fne_statut_certifie") : t("fne_statut_brouillon")}</div>
                </div>
              </div>
              <pre style={S.preFacture}>{texteFacture({ etablissement, facture: factureActive, certifie: Boolean(factureActive.certifie) })}</pre>
              {(factureActive.numberFNE || factureActive.numero) && (
                <img
                  src={urlQrKompto(factureActive) || urlQrVerification(factureActive.numero)}
                  alt={t("fne_qr_alt")}
                  width={140}
                  height={140}
                  style={{ marginTop: 10, border: "1px solid var(--cc-bord)", borderRadius: 8 }}
                />
              )}
              <div style={S.attestationActions}>
                <button type="button" onClick={() => imprimerFacture(factureActive)} style={S.btnSecondaire}>
                  <Printer size={14} /> {t("fne_imprimer")}
                </button>
                <button type="button" onClick={() => partagerFacture(factureActive)} style={S.btnSecondaire}>
                  <MessageCircle size={14} /> {t("fne_partager")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------- ARCHIVE ------------------------------- */}
      {onglet === "archive" && (
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("fne_archive_titre")}</div>
              <div style={S.cardCaption}>{t("fne_archive_sous", { ans: FNE_DUREE_ARCHIVAGE_ANS })} — local + KOMPTO</div>
            </div>
            <button type="button" onClick={async () => setFactures(await chargerFactures(etablissement.id))} style={S.btnPetit}>
              <RefreshCw size={13} /> Recharger
            </button>
          </div>
          {factures.length === 0 ? (
            <div style={S.vide}>{t("fne_archive_vide")}</div>
          ) : (
            <div style={S.listeVentes}>
              {factures.map((f) => {
                const isCert = f.statut === "certifiee" || f.number_fne || f.numberFNE;
                const numeroAffiche = f.number_fne || f.numberFNE || f.numero;
                const lien = f.link_fne || f.linkFNE || (isCert ? lienVerificationKompto(f) || urlVerification(numeroAffiche) : null);
                return (
                  <div key={f.id || f.numero} style={S.ligneVente}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={S.venteDesignation}>{numeroAffiche}</div>
                      <div style={S.venteMeta}>
                        {f.date_emission} · {fmt(f.montant_ttc ?? f.montantTTC ?? 0)} FCFA ·{" "}
                        <span style={{ color: isCert ? "var(--cc-vert)" : "var(--cc-or-clair)", fontWeight: 700 }}>
                          {isCert ? t("fne_statut_certifie") : t("fne_statut_brouillon")}
                        </span>
                        {f.type_fne && ` · ${f.type_fne}`}
                        {f.kompto_entry_id && ` · #${f.kompto_entry_id}`}
                      </div>
                      {lien && (
                        <a href={lien} target="_blank" rel="noopener noreferrer" style={S.lienVerif}>
                          {t("fne_verifier")} <ExternalLink size={11} style={{ display: "inline" }} />
                        </a>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" onClick={() => imprimerFacture({ ...f, lignes: f.lignes || [] })} style={S.btnPetit}>
                        <Printer size={13} />
                      </button>
                      <button type="button" onClick={() => partagerFacture({ ...f, lignes: f.lignes || [] })} style={S.btnPetit}>
                        <MessageCircle size={13} />
                      </button>
                      {f.kompto_entry_id && (
                        <button
                          type="button"
                          onClick={() => {
                            setLookupId(String(f.kompto_entry_id));
                            setLookupMode(isCert ? "getElectronicInvoice" : "getVerify");
                            setOnglet("facturation");
                          }}
                          style={S.btnPetit}
                          title="Relire via KOMPTO"
                        >
                          <Search size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  page: { display: "flex", flexDirection: "column", gap: 14, width: "100%" },
  card: { background: "var(--cc-surface)", border: "1px solid var(--cc-bord)", borderRadius: 14, padding: 16 },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  cardTitle: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "var(--cc-texte)" },
  cardCaption: { fontSize: 12, color: "var(--cc-texte-doux)", marginTop: 3 },
  section: { marginTop: 14, padding: 12, border: "1px solid var(--cc-bord)", borderRadius: 12, background: "var(--cc-surface-2)" },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "var(--cc-texte)" },
  sectionHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 },
  codeInline: { fontFamily: "ui-monospace, monospace", fontSize: 11.5, background: "var(--cc-surface-3)", padding: "1px 5px", borderRadius: 4 },
  cadreCard: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    background: "var(--cc-vert-fond)",
    border: "1px solid var(--cc-vert-bord)",
    borderRadius: 12,
    padding: "12px 14px",
  },
  cadreTitre: { fontFamily: "'Fraunces', serif", fontSize: 14.5, fontWeight: 600, color: "var(--cc-vert)" },
  cadreTexte: { margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--cc-vert)" },
  verrouCard: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    background: "var(--cc-surface-3)",
    border: "1px solid var(--cc-or-pale)",
    borderRadius: 12,
    padding: "14px 16px",
  },
  verrouTitre: { fontFamily: "'Fraunces', serif", fontSize: 15.5, fontWeight: 600, color: "var(--cc-or-clair)" },
  verrouTexte: { margin: "4px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--cc-or-clair)" },
  avertissement: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    background: "var(--cc-rouge-fond)",
    border: "1px solid var(--cc-rouge-bord)",
    borderRadius: 10,
    padding: "10px 12px",
    marginTop: 12,
  },
  avertissementTexte: { margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--cc-rouge)" },
  noticeKompto: { background: "var(--cc-surface-3)", border: "1px solid var(--cc-or-pale)", borderRadius: 10, padding: "10px 12px", marginTop: 12 },
  noticeTitre: { fontSize: 12.5, fontWeight: 700, color: "var(--cc-or-clair)", display: "flex", alignItems: "center", gap: 6 },
  noticeTexte: { margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--cc-texte-corps)" },
  onglets: { display: "flex", gap: 8, flexWrap: "wrap" },
  onglet: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 13px",
    borderRadius: 20,
    border: "1px solid var(--cc-bord)",
    background: "var(--cc-surface)",
    color: "var(--cc-texte-corps)",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  ongletActif: { background: "var(--cc-accent)", color: "var(--cc-or-clair)", borderColor: "var(--cc-or-bord)" },
  statutBadge: { fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20 },
  etapes: { margin: "12px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: "var(--cc-texte-corps)" },
  form: { display: "flex", flexDirection: "column", gap: 12, marginTop: 14 },
  field: { display: "flex", flexDirection: "column", gap: 5, flex: 1 },
  label: { fontSize: 12.5, fontWeight: 600, color: "var(--cc-texte-corps)" },
  labelMini: { fontSize: 11.5, fontWeight: 600, color: "var(--cc-texte-doux)" },
  optionnel: { fontWeight: 400, color: "var(--cc-texte-doux)" },
  hint: { fontSize: 11.5, color: "var(--cc-texte-doux)", lineHeight: 1.45 },
  input: {
    padding: "10px 12px",
    borderRadius: 9,
    border: "1px solid var(--cc-bord)",
    fontSize: 14,
    fontFamily: "'Inter', sans-serif",
    color: "var(--cc-texte)",
    outline: "none",
    background: "var(--cc-surface)",
  },
  inputError: { borderColor: "var(--cc-rouge)", background: "var(--cc-rouge-fond)" },
  twoCol: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" },
  threeCol: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 },
  inlinePair: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  details: { background: "var(--cc-surface-2)", border: "1px solid var(--cc-bord)", borderRadius: 10, padding: "10px 12px" },
  detailsSummary: { fontSize: 12.5, fontWeight: 600, color: "var(--cc-texte-corps)", cursor: "pointer" },
  btnPrimaire: {
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: "var(--cc-degrade-or)",
    color: "var(--cc-texte-inverse)",
    boxShadow: "var(--cc-ombre-or)",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  btnSecondaire: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 14px",
    borderRadius: 9,
    border: "1px solid var(--cc-or)",
    background: "transparent",
    color: "var(--cc-or-clair)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  btnPetit: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 11px",
    borderRadius: 8,
    border: "1px solid var(--cc-bord)",
    background: "var(--cc-surface)",
    color: "var(--cc-texte)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  btnPetitDanger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 11px",
    borderRadius: 8,
    border: "1px solid var(--cc-rouge-bord)",
    background: "var(--cc-rouge-fond)",
    color: "var(--cc-rouge)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  btnIconDanger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 7,
    border: "1px solid var(--cc-rouge-bord)",
    background: "var(--cc-rouge-fond)",
    color: "var(--cc-rouge)",
    cursor: "pointer",
  },
  actionsRow: { display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" },
  listeVentes: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
  ligneVente: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--cc-bord)",
    borderRadius: 10,
    background: "var(--cc-surface-2)",
    flexWrap: "wrap",
  },
  venteDesignation: { fontSize: 13, fontWeight: 600, color: "var(--cc-texte)" },
  venteMeta: { fontSize: 11.5, color: "var(--cc-texte-doux)", marginTop: 3 },
  lienVerif: { fontSize: 11.5, color: "var(--cc-or)", textDecoration: "underline" },
  vide: { marginTop: 12, fontSize: 12.5, color: "var(--cc-texte-doux)" },
  factureApercu: {
    marginTop: 16,
    padding: 14,
    border: "1px dashed var(--cc-or)",
    borderRadius: 12,
    background: "var(--cc-surface)",
  },
  apercuHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 },
  apercuBadgeBrouillon: { fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: "var(--cc-surface-3)", color: "var(--cc-or-clair)" },
  apercuBadgeOk: { fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: "var(--cc-vert-fond)", color: "var(--cc-vert)" },
  totauxGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginTop: 8 },
  totauxCell: { fontSize: 12.5, color: "var(--cc-texte-corps)", background: "var(--cc-surface-2)", padding: "8px 10px", borderRadius: 8 },
  preFacture: {
    margin: "10px 0 0",
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11.5,
    lineHeight: 1.55,
    color: "var(--cc-texte)",
    whiteSpace: "pre-wrap",
    overflowX: "auto",
    background: "var(--cc-surface-2)",
    padding: "10px 12px",
    borderRadius: 8,
  },
  attestationActions: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" },
  avoirBox: { marginTop: 12, padding: 12, border: "1px solid var(--cc-or-pale)", borderRadius: 10, background: "var(--cc-surface-3)" },
  chainBox: { marginTop: 12, padding: 12, border: "1px solid var(--cc-bord)", borderRadius: 10, background: "var(--cc-surface-2)" },
  chainTitle: { fontSize: 12.5, fontWeight: 700, color: "var(--cc-texte)" },
  chainGrid: { display: "grid", gridTemplateColumns: "140px 1fr", gap: 6, marginTop: 8, fontSize: 12 },
  chainLabel: { color: "var(--cc-texte-doux)", fontWeight: 600 },
  chainValue: { fontFamily: "ui-monospace, monospace", color: "var(--cc-texte)", background: "var(--cc-surface)", padding: "2px 6px", borderRadius: 4 },
  message: { padding: "10px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5 },
  messageOk: { background: "var(--cc-vert-fond)", border: "1px solid var(--cc-vert-bord)", color: "var(--cc-vert)" },
  messageKo: { background: "var(--cc-rouge-fond)", border: "1px solid var(--cc-rouge-bord)", color: "var(--cc-rouge)" },
  messageInfo: { background: "var(--cc-surface-3)", border: "1px solid var(--cc-or-pale)", color: "var(--cc-or-clair)" },
  itemCard: { border: "1px solid var(--cc-bord)", borderRadius: 10, padding: 12, background: "var(--cc-surface)" },
  itemHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  itemBadge: { fontSize: 11.5, fontWeight: 700, background: "var(--cc-surface-3)", padding: "3px 8px", borderRadius: 20 },
};
