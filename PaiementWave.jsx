import React, { useState } from "react";
import { supabase } from "./supabaseClient.js";
import { WAVE_QR_SRC, WAVE_QR_DATA_URI } from "./WaveQR.js";

/** Coordonnées Wave / WhatsApp ComptaCi (CI). */
export const WAVE_NUMERO = "05 46 69 74 78";
export const WAVE_NUMERO_CLEAN = "0546697478";
export const WHATSAPP_SUPPORT = "2250501303343";

export const PRIX_PLANS = {
  starter: 7000,
  pro: 10000,
  entreprise: 20000,
};

export const PLANS = ["starter", "pro", "entreprise"];

const fmt = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

/** Image QR scannable : fichier statique d'abord, data-URI en repli. */
export function WaveQrImage({ size = 200, style }) {
  const [src, setSrc] = useState(WAVE_QR_SRC);
  return (
    <img
      src={src}
      alt="Code QR de paiement Wave"
      width={size}
      height={size}
      onError={() => {
        if (src !== WAVE_QR_DATA_URI) setSrc(WAVE_QR_DATA_URI);
      }}
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        border: "1px solid #EDE7DA",
        objectFit: "contain",
        background: "#FFFFFF",
        display: "block",
        ...style,
      }}
    />
  );
}

function nomPlan(t, p) {
  if (p === "pro") return t("paiement_plan_pro");
  if (p === "entreprise") return t("paiement_plan_entreprise");
  return t("paiement_plan_starter");
}

function notePlan(t, p) {
  if (p === "pro") return t("paiement_plan_pro_note");
  if (p === "entreprise") return t("paiement_plan_entreprise_note");
  return t("paiement_plan_starter_note");
}

function montantDuPlan(plan, etablissement) {
  if (
    etablissement?.est_fondateur &&
    etablissement?.tarif_verrouille &&
    (plan === "starter" || plan === "pro")
  ) {
    return Number(etablissement.tarif_verrouille) || PRIX_PLANS[plan];
  }
  return PRIX_PLANS[plan] || PRIX_PLANS.starter;
}

function messageWhatsApp({ t, etablissement, plan, montant, reference, telephone }) {
  const lignes = [
    `Bonjour ComptaCi, je confirme mon paiement Wave.`,
    `Établissement : ${etablissement?.nom || "—"}`,
    `Plan : ${nomPlan(t, plan)} (${fmt(montant)} FCFA/mois)`,
    telephone ? `Téléphone payeur : ${telephone}` : null,
    reference ? `Référence Wave : ${reference}` : null,
    etablissement?.id ? `ID : ${etablissement.id}` : null,
  ].filter(Boolean);
  return lignes.join("\n");
}

/**
 * Bloc complet : choix du plan → QR Wave → formulaire « j'ai payé ».
 * Utilisé par l'écran de blocage (essai expiré) et la page Abonnement.
 */
export default function PaiementWave({
  etablissement,
  t,
  planInitial = null,
  planActuel = null,
  compact = false,
  onDemandeEnvoyee,
}) {
  const [plan, setPlan] = useState(planInitial || planActuel || "starter");
  const [telephone, setTelephone] = useState(etablissement?.telephone || "");
  const [reference, setReference] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [demande, setDemande] = useState(null);
  const [copieOk, setCopieOk] = useState(false);

  const montant = montantDuPlan(plan, etablissement);

  const envoyerDemande = async () => {
    setErreur("");
    if (!etablissement?.id) {
      setErreur(t("paiement_erreur_etab"));
      return;
    }
    if (!plan) {
      setErreur(t("paiement_choisir_plan"));
      return;
    }
    setEnCours(true);
    try {
      const payload = {
        etablissement_id: etablissement.id,
        plan,
        montant,
        telephone_payeur: (telephone || "").trim() || null,
        reference_wave: (reference || "").trim() || null,
        statut: "en_attente",
      };
      const { data, error } = await supabase
        .from("demandes_paiement")
        .insert(payload)
        .select("*")
        .limit(1);
      if (error) throw error;
      const row = data?.[0] || payload;
      setDemande(row);
      onDemandeEnvoyee?.(row);
    } catch (err) {
      console.error("demande paiement:", err);
      // Message clair si la table n'existe pas encore côté Supabase
      const msg = String(err?.message || err);
      if (/demandes_paiement|schema cache|does not exist|42P01/i.test(msg)) {
        setErreur(t("paiement_erreur_table"));
      } else {
        setErreur(t("paiement_erreur_envoi") + (msg ? ` (${msg})` : ""));
      }
    } finally {
      setEnCours(false);
    }
  };

  const ouvrirWhatsApp = () => {
    const texte = messageWhatsApp({
      t,
      etablissement,
      plan,
      montant,
      reference: reference || demande?.reference_wave,
      telephone: telephone || demande?.telephone_payeur,
    });
    const url = `https://wa.me/${WHATSAPP_SUPPORT}?text=${encodeURIComponent(texte)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copierNumero = async () => {
    try {
      await navigator.clipboard.writeText(WAVE_NUMERO_CLEAN);
      setCopieOk(true);
      setTimeout(() => setCopieOk(false), 2000);
    } catch (_) {
      setCopieOk(false);
    }
  };

  return (
    <div style={{ ...S.wrap, ...(compact ? S.wrapCompact : {}) }}>
      {/* 1. Choix du plan */}
      <div style={S.plansRow}>
        {PLANS.map((p) => {
          const actif = plan === p;
          const estActuel = planActuel === p;
          const prix = montantDuPlan(p, etablissement);
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPlan(p);
                setDemande(null);
                setErreur("");
              }}
              style={{
                ...S.planBox,
                ...(actif ? S.planBoxActive : {}),
              }}
            >
              <div style={S.planName}>{nomPlan(t, p)}</div>
              <div style={S.planPrice}>{fmt(prix)} FCFA<span style={S.planUnit}>/mois</span></div>
              <div style={S.planNote}>{notePlan(t, p)}</div>
              {estActuel && <div style={S.planBadge}>{t("abo_plan_actif")}</div>}
            </button>
          );
        })}
      </div>

      {/* 2. QR + montant */}
      <div style={S.qrBlock}>
        <div style={S.montantHint}>
          {t("paiement_a_envoyer")}{" "}
          <strong>
            {fmt(montant)} FCFA
          </strong>{" "}
          — {nomPlan(t, plan)}
        </div>
        <WaveQrImage size={compact ? 180 : 220} />
        <div style={S.waveLine}>
          <span>
            {t("paiement_numero_wave")} <strong>{WAVE_NUMERO}</strong>
          </span>
          <button type="button" onClick={copierNumero} style={S.copyBtn}>
            {copieOk ? t("paiement_numero_copie") : t("paiement_copier_numero")}
          </button>
        </div>
        <p style={S.scanHint}>{t("paiement_scan_hint")}</p>
      </div>

      {/* 3. Formulaire de confirmation */}
      {demande ? (
        <div style={S.successBox}>
          <div style={S.successTitle}>{t("paiement_demande_envoyee_titre")}</div>
          <p style={S.successText}>{t("paiement_demande_envoyee_texte")}</p>
          <div style={S.statutBadge}>{t("paiement_statut_en_attente")}</div>
          <button type="button" onClick={ouvrirWhatsApp} style={S.whatsappBtn}>
            {t("paiement_confirmer_whatsapp")}
          </button>
        </div>
      ) : (
        <div style={S.form}>
          <div style={S.formTitle}>{t("paiement_form_titre")}</div>
          <label style={S.field}>
            <span style={S.label}>{t("paiement_tel_payeur")}</span>
            <input
              type="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder={t("paiement_tel_placeholder")}
              style={S.input}
            />
          </label>
          <label style={S.field}>
            <span style={S.label}>
              {t("paiement_reference")}{" "}
              <span style={S.optionnel}>{t("paiement_optionnel")}</span>
            </span>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("paiement_reference_placeholder")}
              style={S.input}
            />
          </label>
          {erreur && <div style={S.error}>{erreur}</div>}
          <button
            type="button"
            onClick={envoyerDemande}
            disabled={enCours}
            style={S.submitBtn}
          >
            {enCours ? t("paiement_envoi_en_cours") : t("paiement_jai_paye")}
          </button>
          <button type="button" onClick={ouvrirWhatsApp} style={S.whatsappGhost}>
            {t("paiement_contacter_whatsapp")}
          </button>
          <p style={S.notice}>{t("paiement_notice")}</p>
        </div>
      )}
    </div>
  );
}

const S = {
  wrap: { display: "flex", flexDirection: "column", gap: 18, width: "100%" },
  wrapCompact: { gap: 14 },
  plansRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  planBox: {
    flex: "1 1 120px",
    background: "#FBF9F4",
    border: "1.5px solid #EDE7DA",
    borderRadius: 12,
    padding: "12px 10px",
    textAlign: "center",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    color: "inherit",
  },
  planBoxActive: {
    background: "#FBF3E2",
    borderColor: "#D4A24C",
    boxShadow: "0 0 0 1px #D4A24C",
  },
  planName: { fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600, color: "#16213E" },
  planPrice: { fontSize: 13.5, color: "#B4801F", fontWeight: 700, margin: "4px 0" },
  planUnit: { fontSize: 11, fontWeight: 500, color: "#8A8578" },
  planNote: { fontSize: 10.5, color: "#8A8578", lineHeight: 1.35 },
  planBadge: {
    marginTop: 6,
    display: "inline-block",
    fontSize: 10,
    fontWeight: 700,
    color: "#186B4E",
    background: "#E7F5EF",
    padding: "2px 8px",
    borderRadius: 20,
  },
  qrBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "14px 10px",
    background: "#FFFEFB",
    border: "1px solid #EDE7DA",
    borderRadius: 14,
  },
  montantHint: { fontSize: 13.5, color: "#5C5748", textAlign: "center" },
  waveLine: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "center",
    fontSize: 13,
    color: "#5C5748",
  },
  copyBtn: {
    border: "1px solid #E4DDD0",
    background: "#FFFEFB",
    borderRadius: 8,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 600,
    color: "#16213E",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  scanHint: { fontSize: 12, color: "#8A8578", textAlign: "center", margin: 0, maxWidth: 320, lineHeight: 1.45 },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    textAlign: "left",
    background: "#FBF9F4",
    border: "1px solid #EDE7DA",
    borderRadius: 14,
    padding: 16,
  },
  formTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 15,
    fontWeight: 600,
    color: "#16213E",
    textAlign: "center",
  },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 12.5, fontWeight: 600, color: "#5C5748" },
  optionnel: { fontWeight: 400, color: "#8A8578" },
  input: {
    padding: "10px 12px",
    borderRadius: 9,
    border: "1px solid #E4DDD0",
    fontSize: 14,
    fontFamily: "'Inter', sans-serif",
    color: "#16213E",
    outline: "none",
    background: "#FFFEFB",
  },
  error: {
    fontSize: 12.5,
    color: "#B4432A",
    background: "#FBEBE4",
    padding: "8px 10px",
    borderRadius: 8,
    lineHeight: 1.4,
  },
  submitBtn: {
    padding: "12px 0",
    borderRadius: 9,
    border: "none",
    background: "#16213E",
    color: "#F3D9A0",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  whatsappBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "11px 16px",
    borderRadius: 9,
    background: "#186B4E",
    color: "#FFFEFB",
    fontSize: 13.5,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    width: "100%",
  },
  whatsappGhost: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 0",
    borderRadius: 9,
    background: "transparent",
    color: "#186B4E",
    fontSize: 13,
    fontWeight: 600,
    border: "1px solid #186B4E",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  notice: {
    fontSize: 12,
    color: "#8A8578",
    lineHeight: 1.5,
    margin: 0,
    textAlign: "center",
  },
  successBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    background: "#E7F5EF",
    border: "1px solid #B7E0CC",
    borderRadius: 14,
    padding: 18,
    textAlign: "center",
  },
  successTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 16,
    fontWeight: 600,
    color: "#186B4E",
  },
  successText: { fontSize: 13, color: "#2F5B48", lineHeight: 1.5, margin: 0 },
  statutBadge: {
    fontSize: 12,
    fontWeight: 700,
    color: "#8A6420",
    background: "#FBF3E2",
    padding: "6px 12px",
    borderRadius: 20,
  },
};
