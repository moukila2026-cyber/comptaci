/**
 * PaiementFNE.jsx — Paiement de l'option FNE (100 000 FCFA / an / établissement)
 * ------------------------------------------------------------------------------
 * SasPay agrégateur (Wave, Orange Money, MTN MoMo, Moov, carte bancaire).
 * Lien dédié : https://link.saspay.me/ikoziclmohm  (créé sur app.saspay.me)
 * Coût KOMPTO 80k → marge 20k. Facturé d'avance, expiré → statut 'expiree'.
 *
 * Après paiement, le webhook SasPay (supabase/functions/webhook-saspay) appelle
 * traiter_paiement_saspay → activer_option_fne : fne_statut = 'en_cours' +
 * fne_expiration_date = now + 365j sans toucher au plan.
 */
import React, { useState } from "react";
import {
  LIENS_PAIEMENT,
  FNE_PRIX,
  FNE_LIEN,
  FNE_LABEL,
  SASPAY_MOYENS,
  lienPaiementSasPay,
  ouvrirPaiementSasPay,
  refPaiement,
} from "./saspay.js";

const fmt = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

export default function PaiementFNE({ etablissement, t, compact = false, onPaye }) {
  const [copieOk, setCopieOk] = useState(false);
  const [paiementLance, setPaiementLance] = useState(false);
  const [lienCopie, setLienCopie] = useState(false);

  const reference = refPaiement(etablissement, "fne"); // ex: CCI-A1B2C3-202605-fne
  const lien = lienPaiementSasPay({
    montant: FNE_PRIX,
    plan: "fne",
    etablissement,
    reference,
  }) || FNE_LIEN || LIENS_PAIEMENT.fne;

  const lienConfigure = Boolean(lien && lien.length > 0);

  const payer = () => {
    const ok = ouvrirPaiementSasPay({ montant: FNE_PRIX, plan: "fne", etablissement, reference });
    if (ok) {
      setPaiementLance(true);
      onPaye?.();
    }
  };

  const copierLien = async () => {
    try {
      await navigator.clipboard.writeText(lien);
      setLienCopie(true);
      setTimeout(() => setLienCopie(false), 2000);
    } catch (_) {}
  };
  const copierRef = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopieOk(true);
      setTimeout(() => setCopieOk(false), 2000);
    } catch (_) {}
  };

  return (
    <div style={{ ...S.wrap, ...(compact ? S.wrapCompact : {}) }}>
      <div style={S.card}>
        <div style={S.titre}>{FNE_LABEL}</div>
        <div style={S.prix}>
          <span style={S.montant}>{fmt(FNE_PRIX)} FCFA</span>
          <span style={S.unite}> / an / établissement</span>
        </div>
        <p style={S.note}>
          Facturation certifiée DGI via KOMPTO. Coût KOMPTO 80 000 FCFA inclus. Règlement d'avance — validité 365 jours. À l'échéance, la
          certification est coupée jusqu'au renouvellement.
        </p>

        {lienConfigure ? (
          <>
            <div style={S.lienBox}>
              <span style={S.lienLabel}>Lien SasPay FNE</span>
              <a href={lien} target="_blank" rel="noopener noreferrer" style={S.lienValeur}>
                {lien.replace(/^https?:\/\//, "")}
              </a>
              <button type="button" onClick={copierLien} style={S.copyBtn}>
                {lienCopie ? "Lien copié" : "Copier le lien"}
              </button>
            </div>

            <button type="button" onClick={payer} style={S.cta}>
              Payer 100 000 FCFA — activer l'option FNE
            </button>

            <div style={S.saspayMoyens}>
              {SASPAY_MOYENS.map((m) => (
                <span key={m} style={S.chip}>
                  {m}
                </span>
              ))}
            </div>

            <div style={S.refRow}>
              <span>
                Référence : <strong>{reference}</strong>
              </span>
              <button type="button" onClick={copierRef} style={S.copyBtn}>
                {copieOk ? "Copiée" : "Copier"}
              </button>
            </div>

            <p style={S.hint}>{paiementLance ? "Paiement ouvert — validez-le chez SasPay, puis revenez ici et rechargez l'établissement." : "Cliquez pour payer (Wave, Orange Money, MTN, Moov, carte). La page SasPay s'ouvre dans un nouvel onglet."}</p>
          </>
        ) : (
          <>
            <div style={S.indispo}>Lien de paiement FNE non configuré.</div>
            <p style={S.hint}>Vérifiez VITE_SASPAY_URL_FNE (ou LIENS_PAIEMENT.fne) et la variable d'environnement SasPay.</p>
          </>
        )}
      </div>

      <div style={S.aide}>
        Après confirmation SasPay, votre option passe en <em>en_cours</em>. Renseignez ensuite la clé KOMPTO (establishment / pointOfSale / NCC) pour
        passer en <em>active</em>. Sans renouvellement à l'échéance, le statut devient <em>expiree</em> et la certification est bloquée.
      </div>
    </div>
  );
}

const S = {
  wrap: { display: "flex", flexDirection: "column", gap: 12, width: "100%" },
  wrapCompact: { gap: 10 },
  card: { background: "var(--cc-surface)", border: "1px solid var(--cc-or-pale)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 },
  titre: { fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: "var(--cc-texte)" },
  prix: { display: "flex", alignItems: "baseline", gap: 6 },
  montant: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 700, color: "var(--cc-or)" },
  unite: { fontSize: 12.5, color: "var(--cc-texte-doux)" },
  note: { fontSize: 12, color: "var(--cc-texte-corps)", lineHeight: 1.5, margin: 0 },
  cta: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    maxWidth: 360,
    padding: "13px 18px",
    borderRadius: 10,
    border: "none",
    background: "var(--cc-degrade-or)",
    color: "var(--cc-texte-inverse)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    boxShadow: "var(--cc-ombre-or)",
  },
  lienBox: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
    justifyContent: "center",
    background: "var(--cc-surface-2)",
    border: "1px dashed var(--cc-bord-fort)",
    borderRadius: 10,
    padding: "9px 11px",
  },
  lienLabel: { fontSize: 11.5, fontWeight: 600, color: "var(--cc-texte-doux)" },
  lienValeur: { fontSize: 12, fontWeight: 600, color: "var(--cc-or)", textDecoration: "none", wordBreak: "break-all" },
  copyBtn: { border: "1px solid var(--cc-bord)", background: "var(--cc-surface)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600, color: "var(--cc-texte)", cursor: "pointer", fontFamily: "'Inter', sans-serif" },
  saspayMoyens: { display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  chip: { fontSize: 11, fontWeight: 600, color: "var(--cc-texte-corps)", background: "var(--cc-surface-2)", border: "1px solid var(--cc-bord)", padding: "3px 9px", borderRadius: 20 },
  refRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center", fontSize: 12, color: "var(--cc-texte-corps)" },
  hint: { fontSize: 12, color: "var(--cc-texte-doux)", textAlign: "center", margin: 0, lineHeight: 1.45 },
  indispo: { fontSize: 13, fontWeight: 700, color: "var(--cc-or-clair)", background: "var(--cc-surface-3)", border: "1px solid var(--cc-or-pale)", borderRadius: 9, padding: "9px 12px", textAlign: "center" },
  aide: { fontSize: 11.5, color: "var(--cc-texte-doux)", lineHeight: 1.5, background: "var(--cc-surface-2)", border: "1px solid var(--cc-bord)", borderRadius: 9, padding: "9px 11px" },
};
