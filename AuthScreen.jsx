import React, { useState } from "react";
import { supabase, telephoneVersEmail } from "./supabaseClient.js";
import LanguageSelector from "./LanguageSelector.jsx";
import Decor3D from "./Decor3D.jsx";

const SECTEURS_IDS = ["restauration", "quincaillerie", "boutique", "pharmacie"];

export default function AuthScreen({ onAuthenticated, langue, setLangue, t }) {
  const [mode, setMode] = useState("connexion"); // connexion | inscription | rejoindre
  const [telephone, setTelephone] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [nomEtablissement, setNomEtablissement] = useState("");
  const [secteur, setSecteur] = useState("restauration");
  const [codeInvitation, setCodeInvitation] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const traduireErreur = (msg) => {
    if (msg.includes("already registered") || msg.includes("already exists")) {
      return t("auth_erreur_deja_utilise");
    }
    if (msg.includes("Invalid login")) {
      return t("auth_erreur_login");
    }
    if (msg.includes("Password should be")) {
      return t("auth_erreur_mdp");
    }
    return t("auth_erreur_generique");
  };

  const submit = async (e) => {
    e.preventDefault();
    setErreur("");
    if (!telephone || !motDePasse) {
      setErreur(t("auth_champs_requis"));
      return;
    }
    if (mode === "inscription" && !nomEtablissement) {
      setErreur(t("auth_nom_requis"));
      return;
    }
    if (mode === "rejoindre" && !codeInvitation) {
      setErreur(t("auth_code_requis"));
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
        const { data: etabId, error: errRecherche } = await supabase
          .rpc("etablissement_par_code", { code: codeInvitation.trim() });
        if (errRecherche || !etabId) {
          setErreur(t("auth_code_introuvable"));
          setChargement(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({ email, password: motDePasse });
        if (error) throw error;
        const userId = data.user?.id;
        if (userId) {
          const { error: errMembre } = await supabase
            .from("membres")
            .insert({ etablissement_id: etabId, user_id: userId, role: "gerant" });
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
      <Decor3D />
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

        <div style={styles.toggleRow}>
          <button
            type="button"
            onClick={() => setMode("connexion")}
            style={{ ...styles.toggleBtn, ...(mode === "connexion" ? styles.toggleActive : {}) }}
          >
            {t("auth_connexion")}
          </button>
          <button
            type="button"
            onClick={() => setMode("inscription")}
            style={{ ...styles.toggleBtn, ...(mode === "inscription" ? styles.toggleActive : {}) }}
          >
            {t("auth_inscription")}
          </button>
          <button
            type="button"
            onClick={() => setMode("rejoindre")}
            style={{ ...styles.toggleBtn, ...(mode === "rejoindre" ? styles.toggleActive : {}) }}
          >
            {t("auth_rejoindre")}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "inscription" && (
            <label style={styles.field}>
              <span style={styles.label}>{t("auth_nom_etablissement")}</span>
              <input
                type="text"
                value={nomEtablissement}
                onChange={(e) => setNomEtablissement(e.target.value)}
                placeholder={t("auth_nom_placeholder")}
                style={styles.input}
              />
            </label>
          )}

          {mode === "inscription" && (
            <label style={styles.field}>
              <span style={styles.label}>{t("auth_secteur")}</span>
              <select value={secteur} onChange={(e) => setSecteur(e.target.value)} style={styles.input}>
                {SECTEURS_IDS.map((id) => (
                  <option key={id} value={id}>{t(`secteur_${id}`)}</option>
                ))}
              </select>
            </label>
          )}

          {mode === "rejoindre" && (
            <label style={styles.field}>
              <span style={styles.label}>{t("auth_code_invitation")}</span>
              <input
                type="text"
                value={codeInvitation}
                onChange={(e) => setCodeInvitation(e.target.value)}
                placeholder={t("auth_code_placeholder")}
                style={styles.input}
              />
            </label>
          )}

          <label style={styles.field}>
            <span style={styles.label}>{t("auth_telephone")}</span>
            <input
              type="tel"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder={t("auth_telephone_placeholder")}
              style={styles.input}
            />
          </label>

          <label style={styles.field}>
            <span style={styles.label}>{t("auth_mdp")}</span>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder={t("auth_mdp_placeholder")}
              style={styles.input}
              onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}
            />
          </label>

          {erreur && <div style={styles.error}>{erreur}</div>}

          <button type="button" onClick={submit} disabled={chargement} style={styles.submitBtn}>
            {chargement ? t("auth_instant") : mode === "connexion" ? t("auth_connexion") : mode === "rejoindre" ? t("auth_rejoindre_btn") : t("auth_creer_compte")}
          </button>
        </div>
      </div>
      <div style={styles.footer}>SHOPIN30 · 05 01 30 33 43</div>
    </div>
  );
}

const styles = {
  footer: { textAlign: "center", marginTop: 16, fontSize: 11, color: "#B5AF9E", position: "relative", zIndex: 1 },
  wrap: {
    minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    background: "#FBF7F0", fontFamily: "'Inter', sans-serif", padding: 20, position: "relative", overflow: "hidden",
  },
  langRow: { marginBottom: 12, position: "relative", zIndex: 1 },
  card: {
    background: "#FFFEFB", border: "1px solid #EDE7DA", borderRadius: 16, padding: 32,
    width: "100%", maxWidth: 380, position: "relative", zIndex: 1,
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
