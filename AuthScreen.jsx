import React, { useState } from "react";
import {
  supabase,
  identifiantVersEmail,
  identifiantVersTelephone,
} from "./supabaseClient.js";
import LanguageSelector from "./LanguageSelector.jsx";
import { SECTEURS_IDS } from "./secteurs.js";
import { C } from "./theme.js";

export default function AuthScreen({ onAuthenticated, langue, setLangue, t }) {
  const [mode, setMode] = useState("connexion"); // connexion | inscription | rejoindre
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [nomEtablissement, setNomEtablissement] = useState("");
  const [secteur, setSecteur] = useState("restaurant");
  const [codeInvitation, setCodeInvitation] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  // Mot de passe oublié
  const [mdpOublieOuvert, setMdpOublieOuvert] = useState(false);
  const [mdpOublieIdentifiant, setMdpOublieIdentifiant] = useState("");
  const [mdpOublieEtat, setMdpOublieEtat] = useState(null); // null | envoi | envoye | erreur

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

  // Enregistre (ou met à jour) les infos réelles dans la table `profiles`
  // pour qu'elles soient consultables dans Supabase (email, téléphone,
  // nom d'établissement). Non bloquant si la table n'existe pas encore.
  const enregistrerProfil = async (userId, emailUtilise, tel, nom) => {
    try {
      await supabase.from("profiles").upsert(
        {
          user_id: userId,
          email: emailUtilise,
          telephone: tel || null,
          nom_etablissement: nom || null,
          maj_le: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch (e) {
      console.warn("Profil non enregistré (exécutez supabase-comptes.sql) :", e.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErreur("");

    if (mode === "connexion") {
      if (!identifiant || !motDePasse) {
        setErreur(t("auth_champs_requis"));
        return;
      }
    } else if (mode === "inscription") {
      if (!email || !telephone || !motDePasse) {
        setErreur(t("auth_champs_requis"));
        return;
      }
      if (!nomEtablissement) {
        setErreur(t("auth_nom_requis"));
        return;
      }
      if (!email.includes("@")) {
        setErreur(t("auth_email_invalide"));
        return;
      }
    } else if (mode === "rejoindre") {
      if (!codeInvitation || !identifiant || !motDePasse) {
        setErreur(t("auth_champs_requis"));
        return;
      }
    }

    setChargement(true);
    // Email réel OU téléphone (→ email interne pour les anciens comptes)
    const emailUtilise = mode === "inscription"
      ? email.trim().toLowerCase()
      : identifiantVersEmail(identifiant);

    try {
      if (mode === "inscription") {
        const { data, error } = await supabase.auth.signUp({
          email: emailUtilise,
          password: motDePasse,
          options: { data: { nom_etablissement: nomEtablissement, telephone } },
        });
        if (error) throw error;
        const userId = data.user?.id;
        // Si la confirmation d'email est activée côté Supabase, signUp ne
        // renvoie pas de session (data.session === null).
        if (userId && !data.session) {
          setErreur(t("auth_confirmer_email"));
          setChargement(false);
          return;
        }
        let nouvelEtab = null;
        if (userId) {
          await enregistrerProfil(userId, emailUtilise, telephone, nomEtablissement);
          // Correctif définitif : la création de l'établissement (et de la
          // ligne « membres » propriétaire) passe par la fonction RPC
          // `creer_etablissement` (SECURITY DEFINER). Elle insère les deux
          // lignes dans une seule transaction en contournant la RLS.
          const { data: etabData, error: errRpc } = await supabase.rpc("creer_etablissement", {
            nom: nomEtablissement,
            secteur,
            telephone,
          });
          if (errRpc) throw errRpc;
          nouvelEtab = etabData;
        }
        if (onAuthenticated) onAuthenticated(nouvelEtab?.id);
      } else if (mode === "rejoindre") {
        const { data: etabId, error: errRecherche } = await supabase
          .rpc("etablissement_par_code", { code: codeInvitation.trim() });
        if (errRecherche || !etabId) {
          setErreur(t("auth_code_introuvable"));
          setChargement(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({ email: emailUtilise, password: motDePasse });
        if (error) throw error;
        const userId = data.user?.id;
        if (userId && !data.session) {
          setErreur(t("auth_confirmer_email"));
          setChargement(false);
          return;
        }
        if (userId) {
          const { error: errMembre } = await supabase
            .from("membres")
            .insert({ etablissement_id: etabId, user_id: userId, role: "gerant" });
          if (errMembre) throw errMembre;
          const tel = identifiantVersTelephone(identifiant);
          await enregistrerProfil(userId, emailUtilise, tel, null);
        }
        if (onAuthenticated) onAuthenticated(etabId);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: emailUtilise, password: motDePasse });
        if (error) throw error;
        if (onAuthenticated) onAuthenticated();
      }
    } catch (err) {
      setErreur(traduireErreur(err.message));
    } finally {
      setChargement(false);
    }
  };

  const envoyerMdpOublie = async () => {
    const v = mdpOublieIdentifiant.trim();
    if (!v) return;
    setMdpOublieEtat("envoi");
    const emailCible = identifiantVersEmail(v);
    const { error } = await supabase.auth.resetPasswordForEmail(emailCible, {
      redirectTo: `${window.location.origin}/app.html`,
    });
    setMdpOublieEtat(error ? "erreur" : "envoye");
  };

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
              <select
                value={secteur}
                onChange={(e) => setSecteur(e.target.value)}
                style={{ ...styles.input, cursor: "pointer" }}
              >
                {SECTEURS_IDS.map((id) => (
                  <option key={id} value={id}>{t(`secteur_${id}`)}</option>
                ))}
              </select>
              <span style={styles.aideSecteur}>
                {t("auth_secteur_aide", { nb: 20 })}
              </span>
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

          {mode === "inscription" && (
            <label style={styles.field}>
              <span style={styles.label}>{t("auth_email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth_email_placeholder")}
                style={styles.input}
              />
            </label>
          )}

          {mode !== "inscription" && (
            <label style={styles.field}>
              <span style={styles.label}>{t("auth_identifiant")}</span>
              <input
                type="text"
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
                placeholder={t("auth_identifiant_placeholder")}
                style={styles.input}
              />
            </label>
          )}

          {mode === "inscription" && (
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
          )}

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

          {mode === "connexion" && !mdpOublieOuvert && (
            <button type="button" style={styles.mdpOublieLink} onClick={() => setMdpOublieOuvert(true)}>
              {t("auth_mdp_oublie")}
            </button>
          )}

          {mode === "connexion" && mdpOublieOuvert && (
            <div style={styles.mdpOublieBox}>
              <div style={styles.mdpOublieTitre}>{t("auth_mdp_oublie_titre")}</div>
              <div style={styles.mdpOublieTexte}>{t("auth_mdp_oublie_texte")}</div>
              <input
                type="text"
                value={mdpOublieIdentifiant}
                onChange={(e) => setMdpOublieIdentifiant(e.target.value)}
                placeholder={t("auth_identifiant_placeholder")}
                style={styles.input}
                onKeyDown={(e) => { if (e.key === "Enter") envoyerMdpOublie(); }}
              />
              <button
                type="button"
                onClick={envoyerMdpOublie}
                disabled={mdpOublieEtat === "envoi"}
                style={styles.mdpOublieBtn}
              >
                {mdpOublieEtat === "envoi" ? t("auth_mdp_oublie_envoi") : t("auth_mdp_oublie_envoyer")}
              </button>
              {mdpOublieEtat === "envoye" && <div style={styles.success}>{t("auth_mdp_oublie_envoye")}</div>}
              {mdpOublieEtat === "erreur" && <div style={styles.error}>{t("auth_mdp_oublie_erreur")}</div>}
              <button type="button" style={styles.mdpOublieLink} onClick={() => setMdpOublieOuvert(false)}>
                {t("auth_retour")}
              </button>
            </div>
          )}
        </div>
      </div>
      <div style={styles.footer}>SHOPIN30 · 05 01 30 33 43</div>
    </div>
  );
}

const styles = {
  footer: { textAlign: "center", marginTop: 16, fontSize: 11, color: "var(--cc-texte-discret)", position: "relative", zIndex: 1 },
  wrap: {
    minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    fontFamily: "'Inter', sans-serif", padding: 20, position: "relative", overflow: "hidden",
    backgroundImage: "url(/images/photo-boutique.jpg)",
    backgroundSize: "cover", backgroundPosition: "center 30%", backgroundColor: "var(--cc-accent-uni)",
  },
  photoOverlay: {
    position: "absolute", inset: 0,
    background: "linear-gradient(160deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.84) 45%, rgba(0,0,0,0.78) 100%)",
  },
  langRow: { marginBottom: 12, position: "relative", zIndex: 1 },
  card: {
    background: "rgba(21,30,49,0.92)", backdropFilter: "blur(14px)", border: "1px solid var(--cc-bord)",
    borderRadius: 18, padding: 32, width: "100%", maxWidth: 380, position: "relative", zIndex: 1,
    boxShadow: "var(--cc-ombre-forte)",
  },
  brand: { display: "flex", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: 24 },
  brandName: { fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, color: "var(--cc-texte)" },
  toggleRow: { display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" },
  toggleBtn: {
    flex: "1 1 30%", padding: "9px 4px", borderRadius: 9, border: "1px solid var(--cc-bord)", background: "var(--cc-surface)",
    fontSize: 11.5, fontWeight: 600, color: "var(--cc-texte-doux)", cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
  toggleActive: { background: "var(--cc-accent)", borderColor: "var(--cc-or-bord)", color: "var(--cc-or-clair)" },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  aideSecteur: { fontSize: 11, color: "var(--cc-texte-doux)", lineHeight: 1.45 },
  label: { fontSize: 12.5, fontWeight: 600, color: "var(--cc-texte-corps)" },
  input: {
    padding: "10px 12px", borderRadius: 9, border: "1px solid var(--cc-bord)", fontSize: 14,
    fontFamily: "'Inter', sans-serif", color: "var(--cc-texte)", outline: "none",
  },
  error: { fontSize: 12.5, color: "var(--cc-rouge)", background: "var(--cc-rouge-fond)", padding: "8px 10px", borderRadius: 8 },
  success: { fontSize: 12.5, color: "var(--cc-vert)", background: "var(--cc-vert-fond)", padding: "8px 10px", borderRadius: 8 },
  submitBtn: {
    padding: "12px 0", borderRadius: 10, border: "none", background: "var(--cc-degrade-or)", color: "var(--cc-texte-inverse)",
    fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
    boxShadow: "var(--cc-ombre-or)",
  },
  mdpOublieLink: {
    background: "none", border: "none", color: "var(--cc-or)", fontSize: 12.5, fontWeight: 600,
    cursor: "pointer", padding: 0, fontFamily: "'Inter', sans-serif",
  },
  mdpOublieBox: {
    display: "flex", flexDirection: "column", gap: 10, background: "var(--cc-surface-2)", borderRadius: 10, padding: 14,
  },
  mdpOublieTitre: { fontSize: 13, fontWeight: 700, color: "var(--cc-texte)" },
  mdpOublieTexte: { fontSize: 12, color: "var(--cc-texte-doux)", lineHeight: 1.5 },
  mdpOublieBtn: {
    padding: "10px 0", borderRadius: 8, border: "none", background: "var(--cc-accent)", color: "var(--cc-or-clair)",
    fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif",
  },
};
