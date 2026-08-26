import React from "react";
import { supabase } from "./supabaseClient.js";

export default function PaiementEnAttente({ etablissement, essaiTermine, onDeconnexion }) {
  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 14L7 6L12 11L18 3" stroke="#D4A24C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={styles.brandName}>ComptaCi</span>
        </div>

        <div style={styles.title}>
          {essaiTermine ? "Votre essai gratuit de 3 jours est terminé" : "Un dernier pas avant d'accéder à votre tableau de bord"}
        </div>
        <p style={styles.text}>
          {essaiTermine ? (
            <>Pour continuer à utiliser ComptaCi pour <strong>{etablissement?.nom}</strong>, réglez l'abonnement de votre choix
            en scannant ce code avec l'application Wave, puis indiquez le plan choisi.</>
          ) : (
            <>Votre compte pour <strong>{etablissement?.nom}</strong> est créé. Réglez l'abonnement de votre choix
            en scannant ce code avec l'application Wave, puis indiquez le plan choisi.</>
          )}
        </p>

        <div style={styles.plansRow}>
          <div style={styles.planBox}>
            <div style={styles.planName}>Starter</div>
            <div style={styles.planPrice}>7 000 FCFA/mois</div>
            <div style={styles.planNote}>1 établissement, sans gérant</div>
          </div>
          <div style={styles.planBox}>
            <div style={styles.planName}>Pro</div>
            <div style={styles.planPrice}>10 000 FCFA/mois</div>
            <div style={styles.planNote}>+ invitation de gérant</div>
          </div>
        </div>

        <img src="/wave-qr.png" alt="Code QR de paiement Wave" style={styles.qr} />

        <div style={styles.contactBlock}>
          <div style={styles.contactLine}>Numéro Wave : <strong>05 46 69 74 78</strong></div>
          <a href="https://wa.me/2250501303343" target="_blank" rel="noopener noreferrer" style={styles.whatsappBtn}>
            Contacter sur WhatsApp
          </a>
        </div>

        <div style={styles.notice}>
          Une fois le paiement effectué, votre accès sera activé sous peu. Si besoin, contactez directement
          votre gestionnaire ComptaCi pour confirmer votre paiement.
        </div>

        <button onClick={() => supabase.auth.signOut().then(onDeconnexion)} style={styles.logout}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#FBF7F0", fontFamily: "'Inter', sans-serif", padding: 20,
  },
  card: {
    background: "#FFFEFB", border: "1px solid #EDE7DA", borderRadius: 16, padding: 32,
    width: "100%", maxWidth: 420, textAlign: "center",
  },
  brand: { display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 20 },
  brandName: { fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: "#16213E" },
  title: { fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, color: "#16213E", marginBottom: 10 },
  text: { fontSize: 13.5, color: "#5C5748", lineHeight: 1.6, marginBottom: 20 },
  qr: { width: 200, height: 200, borderRadius: 12, border: "1px solid #EDE7DA", marginBottom: 18, objectFit: "cover" },
  contactBlock: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 },
  plansRow: { display: "flex", gap: 10, marginBottom: 20 },
  planBox: { flex: 1, background: "#FBF9F4", border: "1px solid #EDE7DA", borderRadius: 10, padding: "10px 8px", textAlign: "center" },
  planName: { fontFamily: "'Fraunces', serif", fontSize: 13, fontWeight: 600, color: "#16213E" },
  planPrice: { fontSize: 12.5, color: "#B4801F", fontWeight: 600, margin: "3px 0" },
  planNote: { fontSize: 10.5, color: "#8A8578" },
  contactLine: { fontSize: 13, color: "#5C5748" },
  whatsappBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 0",
    borderRadius: 9, background: "#186B4E", color: "#FFFEFB", fontSize: 13, fontWeight: 600,
    textDecoration: "none", fontFamily: "'Inter', sans-serif",
  },
  notice: {
    fontSize: 12.5, color: "#8A8578", background: "#FBF3E2", padding: "12px 14px",
    borderRadius: 10, marginBottom: 18, lineHeight: 1.5,
  },
  logout: {
    background: "none", border: "none", color: "#B4432A", fontSize: 12.5,
    cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
};
