import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { WAVE_QR_SRC, WAVE_QR_DATA_URI } from "./WaveQR.js";

/** Coordonnées Wave / WhatsApp ComptaCi (CI). */
export const WAVE_NUMERO = "05 46 69 74 78";
export const WAVE_NUMERO_CLEAN = "0546697478";
export const WHATSAPP_SUPPORT = "2250501303343";

/**
 * Tarifs officiels ComptaCi (FCFA / mois / établissement) :
 *  - Starter  : 7 000  → c'est aussi le tarif fondateur verrouillé
 *  - Pro      : 10 000 (prix de référence Wave)
 *  - Entreprise : 20 000
 */
export const PRIX_PLANS = {
  starter: 7000,
  pro: 10000,
  entreprise: 20000,
};

export const PLANS = ["starter", "pro", "entreprise"];

/** Tarif fondateur verrouillé = tarif Starter (7 000 FCFA/mois). */
export const PRIX_FONDATEUR = 7000;

/** Nombre d'établissements pouvant bénéficier de l'offre fondateurs. */
export const LIMITE_FONDATEURS = 100;

/** Durée de l'offre fondateurs : 7 jours d'essai en plan STARTER. */
export const JOURS_FONDATEUR = 7;

const JOUR_MS = 86400000;
const HEURE_MS = 3600000;

/**
 * Les 6 caractéristiques affichées dans chaque carte de forfait.
 * (6 clés abo_feat_* par plan → 18 ✅ sur la page Abonnement.)
 */
export const AVANTAGES_PLANS = {
  starter: [
    "abo_feat_1etab",
    "abo_feat_saisie",
    "abo_feat_dashboard",
    "abo_feat_hist30",
    "abo_feat_tva",
    "abo_feat_gerant1",
  ],
  pro: [
    "abo_feat_1etab",
    "abo_feat_saisie",
    "abo_feat_dashboard",
    "abo_feat_histcomplet",
    "abo_feat_tva",
    "abo_feat_gerantillim",
  ],
  entreprise: [
    "abo_feat_multi",
    "abo_feat_saisie",
    "abo_feat_dashboard",
    "abo_feat_histcomplet",
    "abo_feat_tva",
    "abo_feat_gerantillim",
  ],
};

/** L'offre fondateurs est limitée aux 100 premiers établissements. */
export function estFondateur(etablissement) {
  return Boolean(etablissement?.est_fondateur);
}

/**
 * Fin de la fenêtre « offre fondateurs » : date_creation + essai_jours (7 j par défaut).
 * Miroir exact du SQL : now() < date_creation + make_interval(days => coalesce(essai_jours, 7))
 */
export function finEssai(etablissement) {
  const jours = Number(etablissement?.essai_jours) || JOURS_FONDATEUR;
  const brut = etablissement?.date_creation;
  if (!brut) return null;
  const base = new Date(brut);
  const ms = base.getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + jours * JOUR_MS);
}

/**
 * VRAI uniquement pendant la fenêtre de l'offre : le fondateur est alors
 * bloqué sur le plan STARTER à 7 000 FCFA. Après les 7 jours → faux, il
 * choisit librement Starter, Pro ou Entreprise.
 */
export function fondateurVerrouille(etablissement, maintenant = Date.now()) {
  if (!estFondateur(etablissement)) return false;
  const fin = finEssai(etablissement);
  // Sans date de création exploitable, on reste prudent : l'offre est en cours.
  if (!fin) return true;
  return maintenant < fin.getTime();
}

/** Le tarif fondateur verrouillé (7 000 FCFA) s'applique-t-il ? */
export function tarifFondateurActif(etablissement, maintenant = Date.now()) {
  return estFondateur(etablissement) && fondateurVerrouille(etablissement, maintenant);
}

/** Compte à rebours avant le déblocage de Pro / Entreprise. */
export function resteAvantDeblocage(etablissement, maintenant = Date.now()) {
  const fin = finEssai(etablissement);
  const ms = fin
    ? Math.max(0, fin.getTime() - maintenant)
    : JOURS_FONDATEUR * JOUR_MS;
  return {
    ms,
    jours: Math.floor(ms / JOUR_MS),
    heures: Math.floor((ms % JOUR_MS) / HEURE_MS),
  };
}

/** Format « 4 j 3 h » utilisé par le compte à rebours. */
export function formatReste({ jours, heures }) {
  return `${jours} j ${heures} h`;
}

/**
 * Plans réellement choisissables : STARTER seul pendant l'offre fondateurs,
 * les 3 forfaits ensuite (ou pour un établissement non fondateur).
 */
export function plansDisponibles(etablissement, maintenant = Date.now()) {
  return fondateurVerrouille(etablissement, maintenant) ? ["starter"] : PLANS;
}

/** Ramène n'importe quel plan vers « starter » tant que l'offre fondateurs court. */
export function planEffectifFondateur(plan, etablissement, maintenant = Date.now()) {
  return fondateurVerrouille(etablissement, maintenant) ? "starter" : plan;
}

/** Montant à payer pour un plan donné, offre fondateurs comprise. */
export function montantDuPlan(plan, etablissement, maintenant = Date.now()) {
  if (tarifFondateurActif(etablissement, maintenant)) {
    const verrouille = Number(etablissement?.tarif_verrouille);
    return Number.isFinite(verrouille) && verrouille > 0 ? verrouille : PRIX_FONDATEUR;
  }
  return PRIX_PLANS[plan] || PRIX_PLANS.starter;
}

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
 *
 * Les 3 forfaits sont TOUJOURS affichés. Pendant l'offre fondateurs,
 * Pro et Entreprise sont cadenassés (aria-disabled, clic = explication) ;
 * un minuteur interne les débloque à la fin des 7 jours sans rechargement.
 */
export default function PaiementWave({
  etablissement,
  t,
  planInitial = null,
  planActuel = null,
  compact = false,
  onDemandeEnvoyee,
}) {
  const [planBrut, setPlanBrut] = useState(planInitial || planActuel || "starter");
  // Horloge interne : permet de débloquer Pro / Entreprise sans recharger la page.
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [messageVerrou, setMessageVerrou] = useState("");
  const [telephone, setTelephone] = useState(etablissement?.telephone || "");
  const [reference, setReference] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [demande, setDemande] = useState(null);
  const [copieOk, setCopieOk] = useState(false);

  const fondateur = estFondateur(etablissement);
  const verrouille = fondateurVerrouille(etablissement, maintenant);
  const dureeOffre = Number(etablissement?.essai_jours) || JOURS_FONDATEUR;
  const plan = planEffectifFondateur(planBrut, etablissement, maintenant);
  const montant = montantDuPlan(plan, etablissement, maintenant);
  const reste = resteAvantDeblocage(etablissement, maintenant);

  // Minuteur : rafraîchit l'horloge tant que l'offre fondateurs est en cours.
  useEffect(() => {
    if (!fondateur || !verrouille) return undefined;
    const id = setInterval(() => setMaintenant(Date.now()), 30000);
    return () => clearInterval(id);
  }, [fondateur, verrouille]);

  // Synchronise l'état interne dès qu'on bascule sur un fondateur en offre.
  useEffect(() => {
    if (verrouille && planBrut !== "starter") setPlanBrut("starter");
  }, [verrouille, planBrut]);

  const choisirPlan = (p) => {
    if (verrouille && p !== "starter") {
      // Le clic ne change pas de plan : il explique pourquoi c'est verrouillé.
      setMessageVerrou(
        t("paiement_fondateur_verrou_avertissement", {
          tarif: fmt(PRIX_FONDATEUR),
          duree: dureeOffre,
          jours: formatReste(reste),
        })
      );
      return;
    }
    setMessageVerrou("");
    setPlanBrut(p);
    setDemande(null);
    setErreur("");
  };

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
        // Pendant l'offre, la demande est toujours enregistrée en STARTER.
        plan: verrouille ? "starter" : plan,
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
      {/* 0. Rappel de l'offre fondateurs (100 premiers établissements) */}
      {fondateur && (
        <div style={S.fondateurBox}>
          <div style={S.fondateurTitre}>★ {t("paiement_fondateur_titre")}</div>
          {verrouille ? (
            <>
              <p style={S.fondateurNotice}>
                {t("paiement_fondateur_notice", {
                  tarif: fmt(PRIX_FONDATEUR),
                  limite: LIMITE_FONDATEURS,
                  duree: dureeOffre,
                })}
              </p>
              <div style={S.fondateurVerrou}>{t("paiement_fondateur_verrouille")}</div>
              <div style={S.compteRebours}>
                {t("paiement_fondateur_deblocage", { jours: formatReste(reste) })}
              </div>
            </>
          ) : (
            <>
              <p style={S.fondateurNotice}>{t("paiement_fondateur_upgrade")}</p>
              <div style={S.fondateurBadge}>
                {t("paiement_fondateur_badge", {
                  tarif: fmt(PRIX_FONDATEUR),
                  duree: dureeOffre,
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* 1. Choix du plan — les 3 forfaits sont toujours affichés */}
      <div style={S.plansRow}>
        {PLANS.map((p) => {
          const actif = plan === p;
          const estActuel = planActuel === p;
          const bloque = verrouille && p !== "starter";
          const prix = montantDuPlan(p, etablissement, maintenant);
          return (
            <button
              key={p}
              type="button"
              onClick={() => choisirPlan(p)}
              aria-disabled={bloque ? "true" : "false"}
              style={{
                ...S.planBox,
                ...(actif ? S.planBoxActive : {}),
                ...(bloque ? S.planBoxLocked : {}),
              }}
            >
              <div style={S.planName}>
                {nomPlan(t, p)}
                {p === "starter" && fondateur ? ` — ${t("paiement_fondateur_plan_nom")}` : ""}
              </div>
              {bloque ? (
                <div style={S.planLocked}>
                  <span aria-hidden="true">🔒</span> {t("paiement_plan_verrouille")}
                </div>
              ) : (
                <div style={S.planPrice}>
                  {fmt(prix)} FCFA<span style={S.planUnit}>{t("plan_par_mois_court")}</span>
                </div>
              )}
              <div style={S.planNote}>{notePlan(t, p)}</div>
              <ul style={S.planFeatures}>
                {(AVANTAGES_PLANS[p] || []).map((cle) => (
                  <li key={cle} style={S.planFeature}>
                    <span aria-hidden="true" style={S.check}>
                      ✅
                    </span>
                    <span>{t(cle)}</span>
                  </li>
                ))}
              </ul>
              {!bloque && fondateur && !verrouille && p !== "starter" && (
                <div style={S.planUpgrade}>
                  {t("paiement_plan_disponible_fondateur")}
                </div>
              )}
              {estActuel && <div style={S.planBadge}>{t("abo_plan_actif")}</div>}
            </button>
          );
        })}
      </div>

      {messageVerrou && <div style={S.verrouAvertissement}>{messageVerrou}</div>}

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
  fondateurBox: {
    background: "#FBF3E2",
    border: "1px solid #E5C88C",
    borderRadius: 12,
    padding: "10px 12px",
  },
  fondateurTitre: {
    fontSize: 13,
    fontWeight: 700,
    color: "#8A6420",
    fontFamily: "'Inter', sans-serif",
  },
  fondateurNotice: {
    margin: "4px 0 0",
    fontSize: 12,
    lineHeight: 1.45,
    color: "#8A6420",
  },
  fondateurVerrou: {
    marginTop: 6,
    fontSize: 11.5,
    fontWeight: 700,
    color: "#8A6420",
  },
  fondateurBadge: {
    marginTop: 6,
    display: "inline-block",
    fontSize: 11,
    fontWeight: 600,
    color: "#186B4E",
    background: "#E7F5EF",
    padding: "3px 9px",
    borderRadius: 20,
  },
  compteRebours: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: 700,
    color: "#B4801F",
  },
  verrouAvertissement: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "#8A6420",
    background: "#FBF3E2",
    border: "1px solid #E5C88C",
    borderRadius: 10,
    padding: "9px 11px",
  },
  plansRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  planBox: {
    flex: "1 1 160px",
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
  planBoxLocked: {
    background: "#F4F2ED",
    borderStyle: "dashed",
    cursor: "not-allowed",
    opacity: 0.72,
  },
  planName: { fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600, color: "#16213E" },
  planPrice: { fontSize: 13.5, color: "#B4801F", fontWeight: 700, margin: "4px 0" },
  planUnit: { fontSize: 11, fontWeight: 500, color: "#8A8578" },
  planNote: { fontSize: 10.5, color: "#8A8578", lineHeight: 1.35 },
  planLocked: {
    fontSize: 11,
    fontWeight: 700,
    color: "#8A8578",
    margin: "4px 0",
  },
  planFeatures: {
    listStyle: "none",
    margin: "8px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    textAlign: "left",
  },
  planFeature: {
    display: "flex",
    alignItems: "flex-start",
    gap: 5,
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "#5C5748",
  },
  check: { fontSize: 9, lineHeight: 1.5 },
  planUpgrade: {
    marginTop: 7,
    display: "inline-block",
    fontSize: 9.5,
    fontWeight: 700,
    color: "#186B4E",
    background: "#E7F5EF",
    padding: "2px 7px",
    borderRadius: 20,
  },
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
