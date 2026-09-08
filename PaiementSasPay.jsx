import { JOURS_ESSAI, JOURS_FONDATEUR, dureeEssai, finEssai } from "./essai.js";
export { JOURS_ESSAI, JOURS_FONDATEUR, finEssai } from "./essai.js";
/**
 * PaiementSasPay.jsx — Paiement des forfaits ComptaCi par lien SasPay
 * ---------------------------------------------------------------------------
 * Remplace l'ancienne page « Paiement Wave » (supprimée). SasPay est un
 * agrégateur : un seul lien encaisse Wave, Orange Money, MTN MoMo, Moov et la
 * carte bancaire. Chaque forfait a son lien dédié (voir saspay.js) :
 *
 *   Starter    → https://link.saspay.me/vmtjcwrgafk
 *   Pro        → https://link.saspay.me/vrgqoaut3ba
 *   Entreprise → https://link.saspay.me/zszja0kudmy
 *
 * Parcours : choix du forfait → « Payer maintenant » (ouvre le lien SasPay du
 * forfait) → confirmation → activation automatique par le webhook SasPay
 * (`supabase/functions/webhook-saspay`) ou validation manuelle par l'admin.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import {
  SASPAY_CONFIGURE,
  SASPAY_MOYENS,
  LIENS_PAIEMENT,
  lienPlanConfigure,
  lienPaiementSasPay,
  refPaiement,
  ouvrirPaiementSasPay,
  WHATSAPP_SUPPORT,
} from "./saspay.js";

/** Paiement : lien SasPay (Mobile Money + carte). Aucun QR code. */
export { WHATSAPP_SUPPORT, LIENS_PAIEMENT };

/**
 * Tarifs officiels ComptaCi (FCFA / mois / établissement) :
 *  - Starter  : 7 000  → c'est aussi le tarif fondateur verrouillé
 *  - Pro      : 10 000 (prix public)
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

/**
 * Durée de l'essai gratuit : 14 jours pour tous (offre fondateurs comprise).
 * Pendant ces 14 jours, l'établissement ne paie rien : 0 FCFA.
 * À la fin, il choisit librement Starter, Pro ou Entreprise.
 */


/** Alias explicite : c'est la durée d'essai, pas seulement l'offre fondateurs. */


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
 * VRAI uniquement pendant la fenêtre de l'offre : le fondateur est alors
 * bloqué pendant l'essai de 14 jours (0 FCFA). Après les 14 jours → faux, il
 * choisit librement Starter, Pro ou Entreprise.
 */
export function fondateurVerrouille(etablissement, maintenant = Date.now()) {
  if (!estFondateur(etablissement) || etablissement?.abonnement_actif) return false;
  const fin = finEssai(etablissement);
  // Sans date de création exploitable, on reste prudent : l'offre est en cours.
  if (!fin) return true;
  return maintenant < fin.getTime();
}

/** Le tarif fondateur verrouillé (tarif Starter) s'applique-t-il ? */
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
    `Bonjour ComptaCi, je confirme mon paiement SasPay.`,
    `Établissement : ${etablissement?.nom || "—"}`,
    `Plan : ${nomPlan(t, plan)} (${fmt(montant)} FCFA/mois)`,
    telephone ? `Téléphone payeur : ${telephone}` : null,
    reference ? `Référence SasPay : ${reference}` : null,
    etablissement?.id ? `ID : ${etablissement.id}` : null,
  ].filter(Boolean);
  return lignes.join("\n");
}

/**
 * Bloc complet : choix du plan → lien SasPay du forfait → « j'ai payé ».
 * Utilisé par l'écran de blocage (essai expiré) et la page Abonnement.
 *
 * Les 3 forfaits sont TOUJOURS affichés. Pendant l'offre fondateurs,
 * Pro et Entreprise sont cadenassés (aria-disabled, clic = explication) ;
 * un minuteur interne les débloque à la fin des 14 jours sans rechargement.
 */
export default function PaiementSasPay({
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
  // Lien SasPay ouvert : on bascule alors sur le bloc « j'ai payé ».
  const [paiementLance, setPaiementLance] = useState(false);
  const [lienCopie, setLienCopie] = useState(false);

  const fondateur = estFondateur(etablissement);
  const verrouille = fondateurVerrouille(etablissement, maintenant);
  const dureeOffre = dureeEssai(etablissement);
  const plan = planEffectifFondateur(planBrut, etablissement, maintenant);
  const montant = montantDuPlan(plan, etablissement, maintenant);
  const reste = resteAvantDeblocage(etablissement, maintenant);
  // Référence affichée AVANT paiement : elle est reprise dans la demande.
  const referencePaiement = refPaiement(etablissement, plan);
  // Lien SasPay du forfait sélectionné (avec la référence en paramètre).
  const lienDuPlanChoisi =
    lienPaiementSasPay({
      montant,
      plan,
      etablissement,
      reference: referencePaiement,
      telephone: (telephone || "").trim() || null,
    }) || "";
  const lienConfigure = lienPlanConfigure(plan);

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

  /** Ouvre le lien de paiement SasPay (Wave, Orange Money, MTN, Moov, carte). */
  const payerAvecSasPay = () => {
    const ouvert = ouvrirPaiementSasPay({
      montant,
      plan,
      etablissement,
      reference: referencePaiement,
      telephone: (telephone || "").trim() || null,
    });
    if (!ouvert) {
      setErreur(t("paiement_saspay_erreur"));
      return;
    }
    setErreur("");
    setPaiementLance(true);
  };

  /** Copie le lien de paiement du forfait (utile pour le payer sur un autre appareil). */
  const copierLien = async () => {
    try {
      await navigator.clipboard.writeText(lienDuPlanChoisi);
      setLienCopie(true);
      setTimeout(() => setLienCopie(false), 2000);
    } catch (_) {
      setLienCopie(false);
    }
  };

  /** Copie la référence de paiement (utile pour le support). */
  const copierReference = async () => {
    try {
      await navigator.clipboard.writeText(referencePaiement);
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

      {/* 2. Paiement sécurisé SasPay (Mobile Money + carte) */}
      <div style={S.payBlock}>
        <div style={S.montantHint}>
          {t("paiement_a_envoyer")}{" "}
          <strong>
            {fmt(montant)} FCFA
          </strong>{" "}
          — {nomPlan(t, plan)}
        </div>

        {lienConfigure ? (
          <>
            {/* Lien SasPay du forfait : copiable / partageable */}
            <div style={S.lienBox}>
              <span style={S.lienLabel}>{t("paiement_saspay_lien")}</span>
              <a
                href={lienDuPlanChoisi}
                target="_blank"
                rel="noopener noreferrer"
                style={S.lienValeur}
              >
                {lienDuPlanChoisi.replace(/^https?:\/\//, "")}
              </a>
              <button type="button" onClick={copierLien} style={S.copyBtn}>
                {lienCopie ? t("paiement_saspay_lien_copie") : t("paiement_saspay_copier_lien")}
              </button>
            </div>

            <button
              type="button"
              onClick={payerAvecSasPay}
              style={S.saspayBtn}
              aria-label={t("paiement_saspay_cta")}
            >
              {t("paiement_saspay_cta")}
            </button>

            <div style={S.saspayMoyens}>
              {SASPAY_MOYENS.map((m) => (
                <span key={m} style={S.saspayChip}>
                  {m}
                </span>
              ))}
            </div>

            <div style={S.saspayRef}>
              <span>
                {t("paiement_reference")} : <strong>{referencePaiement}</strong>
              </span>
              <button type="button" onClick={copierReference} style={S.copyBtn}>
                {copieOk ? t("paiement_numero_copie") : t("paiement_copier_reference")}
              </button>
            </div>

            <p style={S.scanHint}>
              {paiementLance
                ? t("paiement_saspay_apres_paiement")
                : t("paiement_saspay_hint")}
            </p>
          </>
        ) : (
          <>
            <div style={S.saspayIndispo}>{t("paiement_saspay_indispo_titre")}</div>
            <p style={S.scanHint}>{t("paiement_saspay_indispo_texte")}</p>
          </>
        )}

        <button type="button" onClick={ouvrirWhatsApp} style={S.whatsappGhost}>
          {t("paiement_contacter_whatsapp")}
        </button>
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
              placeholder={referencePaiement}
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
    background: "var(--cc-surface-3)",
    border: "1px solid var(--cc-or-pale)",
    borderRadius: 12,
    padding: "10px 12px",
  },
  fondateurTitre: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--cc-or-clair)",
    fontFamily: "'Inter', sans-serif",
  },
  fondateurNotice: {
    margin: "4px 0 0",
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--cc-or-clair)",
  },
  fondateurVerrou: {
    marginTop: 6,
    fontSize: 11.5,
    fontWeight: 700,
    color: "var(--cc-or-clair)",
  },
  fondateurBadge: {
    marginTop: 6,
    display: "inline-block",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--cc-vert)",
    background: "var(--cc-vert-fond)",
    padding: "3px 9px",
    borderRadius: 20,
  },
  compteRebours: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: 700,
    color: "var(--cc-or)",
  },
  verrouAvertissement: {
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--cc-or-clair)",
    background: "var(--cc-surface-3)",
    border: "1px solid var(--cc-or-pale)",
    borderRadius: 10,
    padding: "9px 11px",
  },
  plansRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  planBox: {
    flex: "1 1 160px",
    background: "var(--cc-surface-2)",
    border: "1.5px solid var(--cc-bord)",
    borderRadius: 12,
    padding: "12px 10px",
    textAlign: "center",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    color: "inherit",
  },
  planBoxActive: {
    background: "var(--cc-surface-3)",
    borderColor: "var(--cc-or)",
    boxShadow: "0 0 0 1px var(--cc-or)",
  },
  planBoxLocked: {
    background: "var(--cc-surface-2)",
    borderStyle: "dashed",
    cursor: "not-allowed",
    opacity: 0.72,
  },
  planName: { fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600, color: "var(--cc-texte)" },
  planPrice: { fontSize: 13.5, color: "var(--cc-or)", fontWeight: 700, margin: "4px 0" },
  planUnit: { fontSize: 11, fontWeight: 500, color: "var(--cc-texte-doux)" },
  planNote: { fontSize: 10.5, color: "var(--cc-texte-doux)", lineHeight: 1.35 },
  planLocked: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--cc-texte-doux)",
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
    color: "var(--cc-texte-corps)",
  },
  check: { fontSize: 9, lineHeight: 1.5 },
  planUpgrade: {
    marginTop: 7,
    display: "inline-block",
    fontSize: 9.5,
    fontWeight: 700,
    color: "var(--cc-vert)",
    background: "var(--cc-vert-fond)",
    padding: "2px 7px",
    borderRadius: 20,
  },
  planBadge: {
    marginTop: 6,
    display: "inline-block",
    fontSize: 10,
    fontWeight: 700,
    color: "var(--cc-vert)",
    background: "var(--cc-vert-fond)",
    padding: "2px 8px",
    borderRadius: 20,
  },
  payBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: "16px 14px",
    background: "var(--cc-surface)",
    border: "1px solid var(--cc-bord)",
    borderRadius: 14,
  },
  montantHint: { fontSize: 13.5, color: "var(--cc-texte-corps)", textAlign: "center" },
  saspayBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    maxWidth: 340,
    padding: "14px 18px",
    borderRadius: 12,
    border: "none",
    background: "var(--cc-degrade-or)",
    color: "var(--cc-texte-inverse)",
    boxShadow: "var(--cc-ombre-or)",
    fontSize: 14.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  lienBox: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
    maxWidth: 420,
    justifyContent: "center",
    background: "var(--cc-surface-2)",
    border: "1px dashed var(--cc-bord-fort)",
    borderRadius: 10,
    padding: "9px 11px",
  },
  lienLabel: { fontSize: 11.5, fontWeight: 600, color: "var(--cc-texte-doux)" },
  lienValeur: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--cc-or)",
    textDecoration: "none",
    wordBreak: "break-all",
  },
  saspayMoyens: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
  },
  saspayChip: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--cc-texte-corps)",
    background: "var(--cc-surface-2)",
    border: "1px solid var(--cc-bord)",
    padding: "3px 9px",
    borderRadius: 20,
  },
  saspayRef: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
    fontSize: 12,
    color: "var(--cc-texte-corps)",
  },
  saspayIndispo: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--cc-or-clair)",
    background: "var(--cc-surface-3)",
    border: "1px solid var(--cc-or-pale)",
    borderRadius: 9,
    padding: "9px 12px",
    textAlign: "center",
  },
  waveLine: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "center",
    fontSize: 13,
    color: "var(--cc-texte-corps)",
  },
  copyBtn: {
    border: "1px solid var(--cc-bord)",
    background: "var(--cc-surface)",
    borderRadius: 8,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--cc-texte)",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  scanHint: { fontSize: 12, color: "var(--cc-texte-doux)", textAlign: "center", margin: 0, maxWidth: 320, lineHeight: 1.45 },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    textAlign: "left",
    background: "var(--cc-surface-2)",
    border: "1px solid var(--cc-bord)",
    borderRadius: 14,
    padding: 16,
  },
  formTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 15,
    fontWeight: 600,
    color: "var(--cc-texte)",
    textAlign: "center",
  },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 12.5, fontWeight: 600, color: "var(--cc-texte-corps)" },
  optionnel: { fontWeight: 400, color: "var(--cc-texte-doux)" },
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
  error: {
    fontSize: 12.5,
    color: "var(--cc-rouge)",
    background: "var(--cc-rouge-fond)",
    padding: "8px 10px",
    borderRadius: 8,
    lineHeight: 1.4,
  },
  submitBtn: {
    padding: "12px 0",
    borderRadius: 10,
    border: "none",
    background: "var(--cc-degrade-or)",
    color: "var(--cc-texte-inverse)",
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
    background: "var(--cc-vert)",
    color: "var(--cc-surface)",
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
    color: "var(--cc-vert)",
    fontSize: 13,
    fontWeight: 600,
    border: "1px solid var(--cc-vert)",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  notice: {
    fontSize: 12,
    color: "var(--cc-texte-doux)",
    lineHeight: 1.5,
    margin: 0,
    textAlign: "center",
  },
  successBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    background: "var(--cc-vert-fond)",
    border: "1px solid var(--cc-vert-bord)",
    borderRadius: 14,
    padding: 18,
    textAlign: "center",
  },
  successTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 16,
    fontWeight: 600,
    color: "var(--cc-vert)",
  },
  successText: { fontSize: 13, color: "var(--cc-vert)", lineHeight: 1.5, margin: 0 },
  statutBadge: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--cc-or-clair)",
    background: "var(--cc-surface-3)",
    padding: "6px 12px",
    borderRadius: 20,
  },
};
