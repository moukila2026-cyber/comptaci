import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import LanguageSelector from "./LanguageSelector.jsx";
import PaiementWave from "./PaiementWave.jsx";

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
    <div style={styles.wrap}>
      <div style={styles.photoOverlay} />
      <div style={styles.langRow}>
        <LanguageSelector langue={langue} onChange={setLangue} />
      </div>
      <div style={styles.card}>
        <div style={styles.brand}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 14L7 6L12 11L18 3" stroke="#D4A24C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={styles.brandName}>ComptaCi</span>
        </div>

        <div style={styles.title}>
          {essaiTermine
            ? t("paiement_titre_expire", { jours: etablissement?.essai_jours || 7 })
            : t("paiement_titre_actif")}
        </div>
        {etablissement?.est_fondateur && (
          <div style={styles.fondateurBadge}>
            ★ {t("paiement_fondateur_badge", { tarif: fmt(etablissement.tarif_verrouille || 7000) })}
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

        <PaiementWave
          etablissement={etablissement}
          t={t}
          planInitial={demandeExistante?.plan || etablissement?.plan || "starter"}
          planActuel={etablissement?.abonnement_actif ? etablissement?.plan : null}
          essaiEnCours={!essaiTermine}
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
  footer: { textAlign: "center", marginTop: 16, fontSize: 11, color: "#B5AF9E", position: "relative", zIndex: 1 },
  langRow: { marginBottom: 12, position: "relative", zIndex: 1 },
  fondateurBadge: {
    background: "#16213E", color: "#F3D9A0", fontSize: 11.5, fontWeight: 700, padding: "6px 12px",
    borderRadius: 20, marginBottom: 14, display: "inline-block",
  },
  wrap: {
    minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    fontFamily: "'Inter', sans-serif", padding: 20, position: "relative", overflow: "hidden",
    backgroundImage: "url(/images/promo-controle.png)",
    backgroundSize: "cover", backgroundPosition: "center 15%", backgroundColor: "#16213E",
  },
  photoOverlay: {
    position: "absolute", inset: 0,
    background: "linear-gradient(160deg, rgba(22,33,62,0.93) 0%, rgba(22,33,62,0.87) 45%, rgba(22,33,62,0.74) 100%)",
  },
  card: {
    background: "#FFFEFB", border: "1px solid #EDE7DA", borderRadius: 16, padding: 28,
    width: "100%", maxWidth: 520, textAlign: "center", position: "relative", zIndex: 1,
  },
  brand: { display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 18 },
  brandName: { fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: "#16213E" },
  title: { fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "#16213E", marginBottom: 10 },
  text: { fontSize: 13.5, color: "#5C5748", lineHeight: 1.6, marginBottom: 16 },
  attenteBanner: {
    background: "#FBF3E2", color: "#8A6420", fontSize: 12.5, fontWeight: 600,
    padding: "10px 12px", borderRadius: 10, marginBottom: 14, lineHeight: 1.45,
  },
  logout: {
    background: "none", border: "none", color: "#B4432A", fontSize: 12.5,
    cursor: "pointer", fontFamily: "'Inter', sans-serif", marginTop: 18,
  },
};
