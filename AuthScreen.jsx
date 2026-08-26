import React, { useState } from "react";
import { supabase, telephoneVersEmail } from "./supabaseClient.js";

export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("connexion"); // connexion | inscription | rejoindre
  const [telephone, setTelephone] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [nomEtablissement, setNomEtablissement] = useState("");
  const [secteur, setSecteur] = useState("restauration");
  const [codeInvitation, setCodeInvitation] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErreur("");
    if (!telephone || !motDePasse) {
      setErreur("Merci de remplir tous les champs.");
      return;
    }
    if (mode === "inscription" && !nomEtablissement) {
      setErreur("Merci d'indiquer le nom de l'établissement.");
      return;
    }
    if (mode === "rejoindre" && !codeInvitation) {
      setErreur("Merci d'indiquer le code d'invitation reçu du propriétaire.");
      return;
    }
    setChargement(true);
    const email = telephoneVersEmail(telephone);

    try {
      if (mode === "inscription") {
        const { data, error } = await supabase.auth.signUp({ email, password: motDePasse });
        if (error) throw error;
        const userId = data.user?.id;
        if (userId) {
          const { data: etab, error: errEtab } = await supabase
            .from("etablissements")
            .insert({ proprietaire_id: userId, nom: nomEtablissement, telephone, secteur })
            .select()
            .single();
          if (errEtab) throw errEtab;
          const { error: errMembre } = await supabase
            .from("membres")
            .insert({ etablissement_id: etab.id, user_id: userId, role: "proprietaire" });
          if (errMembre) throw errMembre;
        }
        onAuthenticated();
      } else if (mode === "rejoindre") {
        const { data: etab, error: errRecherche } = await supabase
          .from("etablissements")
          .select("id")
          .eq("code_invitation", codeInvitation.trim().toUpperCase())
          .maybeSingle();
        if (errRecherche || !etab) {
          setErreur("Code d'invitation introuvable. Vérifiez-le auprès du propriétaire.");
          setChargement(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({ email, password: motDePasse });
        if (error) throw error;
        const userId = data.user?.id;
        if (userId) {
          const { error: errMembre } = await supabase
            .from("membres")
            .insert({ etablissement_id: etab.id, user_id: userId, role: "gerant" });
          if (errMembre) throw errMembre;
        }
        onAuthenticated();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
        if (error) throw error;
        onAuthenticated();
      }
    } catch (err) {
      setErreur(traduireErreur(err.message));
    } finally {
      setChargement(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M2 14L7 6L12 11L18 3" stroke="#D4A24C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={styles.brandName}>ComptaCi</span>
        </div>

        <div style={styles.toggleRow}>
          <button
            type="button"
            onClick={() => setMode("connexion")}
            style={{ ...styles.toggleBtn, ...(mode === "connexion" ? styles.toggleActive : {}) }}
          >
            Se connecter
          </button>
          <button
            type="button"
            onClick={() => setMode("inscription")}
            style={{ ...styles.toggleBtn, ...(mode === "inscription" ? styles.toggleActive : {}) }}
          >
            Créer un établissement
          </button>
          <button
            type="button"
            onClick={() => setMode("rejoindre")}
            style={{ ...styles.toggleBtn, ...(mode === "rejoindre" ? styles.toggleActive : {}) }}
          >
            Rejoindre comme gérant
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "inscription" && (
            <label style={styles.field}>
              <span style={styles.label}>Nom de l'établissement</span>
              <input
                type="text"
                value={nomEtablissement}
                onChange={(e) => setNomEtablissement(e.target.value)}
                placeholder="Ex : Maquis Le Bon Coin"
                style={styles.input}
              />
            </label>
          )}

          {mode === "inscription" && (
            <label style={styles.field}>
              <span style={styles.label}>Secteur d'activité</span>
              <select value={secteur} onChange={(e) => setSecteur(e.target.value)} style={styles.input}>
                <option value="restauration">Restauration / Bar / Maquis / Hôtel</option>
                <option value="quincaillerie">Quincaillerie</option>
                <option value="boutique">Boutique</option>
                <option value="pharmacie">Pharmacie</option>
              </select>
            </label>
          )}

          {mode === "rejoindre" && (
            <label style={styles.field}>
              <span style={styles.label}>Code d'invitation</span>
              <input
                type="text"
                value={codeInvitation}
                onChange={(e) => setCodeInvitation(e.target.value)}
                placeholder="Reçu du propriétaire de l'établissement"
                style={styles.input}
              />
            </label>
          )}

          <label style={styles.field}>
            <span style={styles.label}>Numéro de téléphone</span>
            <input
              type="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder="Ex : 0700000000"
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>Mot de passe</span>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder="6 caractères minimum"
              style={styles.input}
              onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
            />
          </label>

          {erreur && <div style={styles.error}>{erreur}</div>}

          <button type="button" onClick={submit} disabled={chargement} style={styles.submitBtn}>
            {chargement ? "Un instant…" : mode === "connexion" ? "Se connecter" : mode === "rejoindre" ? "Rejoindre l'établissement" : "Créer mon compte"}
          </button>
        </div>
      </div>
    </div>
  );
}

function traduireErreur(msg) {
  if (msg.includes("already registered") || msg.includes("already exists")) {
    return "Ce numéro de téléphone est déjà utilisé. Essayez de vous connecter.";
  }
  if (msg.includes("Invalid login")) {
    return "Numéro de téléphone ou mot de passe incorrect.";
  }
  if (msg.includes("Password should be")) {
    return "Le mot de passe doit contenir au moins 6 caractères.";
  }
  return "Une erreur est survenue. Réessayez.";
}

const styles = {
  wrap: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#FBF7F0", fontFamily: "'Inter', sans-serif", padding: 20,
  },
  card: {
    background: "#FFFEFB", border: "1px solid #EDE7DA", borderRadius: 16, padding: 32,
    width: "100%", maxWidth: 380,
  },
  brand: { display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 24 },
  brandName: { fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, color: "#16213E" },
  toggleRow: { display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" },
  toggleBtn: {
    flex: "1 1 30%", padding: "9px 4px", borderRadius: 9, border: "1px solid #E4DDD0", background: "#FFFEFB",
    fontSize: 11.5, fontWeight: 600, color: "#8A8578", cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  toggleActive: { background: "#16213E", borderColor: "#16213E", color: "#F3D9A0" },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12.5, fontWeight: 600, color: "#5C5748" },
  input: {
    padding: "10px 12px", borderRadius: 9, border: "1px solid #E4DDD0", fontSize: 14,
    fontFamily: "'Inter', sans-serif", color: "#16213E", outline: "none",
  },
  error: { fontSize: 12.5, color: "#B4432A", background: "#FBEBE4", padding: "8px 10px", borderRadius: 8 },
  submitBtn: {
    padding: "12px 0", borderRadius: 9, border: "none", background: "#16213E", color: "#F3D9A0",
    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
};
