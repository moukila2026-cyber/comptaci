import { dureeEssai } from "./essai.js";
import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import LanguageSelector from "./LanguageSelector.jsx";
import PaiementSasPay, { PRIX_FONDATEUR } from "./PaiementSasPay.jsx";
import { C } from "./theme.js";

const fmt = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

export default function PaiementEnAttente({ etablissement, essaiTermine, onDeconnexion, langue, setLangue, t, onAbonnementActif }) {
  const [demandeExistante, setDemandeExistante] = useState(null);

  // Si une demande est déjà en attente, on l'affiche ; on poll aussi
  // l'activation de l'abonnement (l'admin active côté Supabase).
  useEffect(() => {
    if (!etablissement?.id) return;
    let annule = false;

    const charger = async () => {
      try {
        const { data } = await supabase
          .from("demandes_paiement")
          .select("*")
          .eq("etablissement_id", etablissement.id)
          .eq("statut", "en_attente")
          .order("cree_le", { ascending: false })
          .limit(1);
        if (!annule && data?.[0]) setDemandeExistante(data[0]);
      } catch (_) {
        // Table absente : on ignore, le formulaire affichera l'erreur au submit.
      }
    };

    const verifierActivation = async () => {
      try {
        const { data } = await supabase
          .from("etablissements")
          .select("id, abonnement_actif, plan")
          .eq("id", etablissement.id)
          .limit(1);
        if (!annule && data?.[0]?.abonnement_actif) {
          onAbonnementActif?.(data[0]);
        }
      } catch (_) {}
    };

    charger();
    const poll = setInterval(verifierActivation, 15000);
    return () => {
      annule = true;
      clearInterval(poll);
    };
  }, [etablissement?.id]);

  return (
    <div className="cc-ecran" style={styles.wrap}>
      <div style={styles.photoOverlay} />
      <div style={styles.langRow}>
        <LanguageSelector langue={langue} onChange={setLangue} />
      </div>
      <div className="cc-card" style={styles.card}>
        <div style={styles.brand}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 14L7 6L12 11L18 3" stroke={C.or} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={styles.brandName}>ComptaCi</span>
        </div>

        <div style={styles.title}>
          {essaiTermine
            ? t("paiement_titre_expire", { jours: dureeEssai(etablissement) })
            : t("paiement_titre_actif")}
        </div>
        {etablissement?.est_fondateur && (
          <div style={styles.fondateurBadge}>
            ★ {t("paiement_fondateur_badge", {
              tarif: fmt(etablissement.tarif_verrouille || PRIX_FONDATEUR),
              duree: dureeEssai(etablissement),
            })}
          </div>
        )}
        <p style={styles.text}>
          {essaiTermine
            ? t("paiement_texte_expire", { nom: etablissement?.nom || "" })
            : t("paiement_texte_actif", { nom: etablissement?.nom || "" })}
        </p>

        {demandeExistante && (
          <div style={styles.attenteBanner}>
            {t("paiement_demande_deja_en_attente", {
              plan: demandeExistante.plan,
              montant: fmt(demandeExistante.montant),
            })}
          </div>
        )}

        <PaiementSasPay
          etablissement={etablissement}
          t={t}
          planInitial={demandeExistante?.plan || etablissement?.plan || "starter"}
          planActuel={etablissement?.abonnement_actif ? etablissement?.plan : null}
        />

        <button onClick={() => supabase.auth.signOut().then(onDeconnexion)} style={styles.logout}>
          {t("paiement_deconnexion")}
        </button>
      </div>
      <div style={styles.footer}>SHOPIN30 · 05 01 30 33 43</div>
    </div>
  );
}

const styles = {
  footer: { textAlign: "center", marginTop: 16, fontSize: 11, color: "var(--cc-texte-discret)", position: "relative", zIndex: 1 },
  langRow: { marginBottom: 12, position: "relative", zIndex: 1 },
  fondateurBadge: {
    background: "var(--cc-accent)", color: "var(--cc-or-clair)", fontSize: 11.5, fontWeight: 700, padding: "6px 12px",
    borderRadius: 20, marginBottom: 14, display: "inline-block",
  },
  wrap: {
    minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    fontFamily: "'Inter', sans-serif", padding: 20, position: "relative", overflow: "hidden",
    backgroundImage: "url(/images/promo-controle.png)",
    backgroundSize: "cover", backgroundPosition: "center 15%", backgroundColor: "var(--cc-accent-uni)",
  },
  photoOverlay: {
    position: "absolute", inset: 0,
    background: "linear-gradient(160deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.84) 45%, rgba(0,0,0,0.7) 100%)",
  },
  card: {
    background: "rgba(21,30,49,0.92)", backdropFilter: "blur(14px)", border: "1px solid var(--cc-bord)",
    borderRadius: 18, padding: 28, width: "100%", maxWidth: 520, textAlign: "center",
    position: "relative", zIndex: 1, boxShadow: "var(--cc-ombre-forte)",
  },
  brand: { display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 18 },
  brandName: { fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: "var(--cc-texte)" },
  title: { fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "var(--cc-texte)", marginBottom: 10 },
  text: { fontSize: 13.5, color: "var(--cc-texte-corps)", lineHeight: 1.6, marginBottom: 16 },
  attenteBanner: {
    background: "var(--cc-surface-3)", color: "var(--cc-or-clair)", fontSize: 12.5, fontWeight: 600,
    padding: "10px 12px", borderRadius: 10, marginBottom: 14, lineHeight: 1.45,
  },
  logout: {
    background: "none", border: "none", color: "var(--cc-rouge)", fontSize: 12.5,
    cursor: "pointer", fontFamily: "'Inter', sans-serif", marginTop: 18,
  },
};
