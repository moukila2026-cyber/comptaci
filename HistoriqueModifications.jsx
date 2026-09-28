import React, { useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { C } from "./theme.js";
import { champsModifies, valeurHistorique } from "./historiqueModifications.js";
import "./historiqueModifications.css";

const TAILLE_PAGE = 25;
const ENTITES = ["transactions", "produits", "fournisseurs", "sessions_caisse", "etablissements"];

// Double protection : aucune requête du composant pour un gérant, et RLS côté base.
export default function HistoriqueModifications({ role, etablissementId, ...props }) {
  if (role !== "proprietaire" || !etablissementId) return null;
  return <Journal key={etablissementId} etablissementId={etablissementId} {...props} />;
}

function Journal({ etablissementId, t, langue = "fr", client = supabase }) {
  const [entite, setEntite] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [etat, setEtat] = useState({ lignes: [], suite: false, chargement: true, erreur: null });

  useEffect(() => {
    let actif = true;
    setEtat({ lignes: [], suite: false, chargement: true, erreur: null });
    (async () => {
      try {
        let requete = client.from("historique_modifications")
          .select("id, cree_le, auteur_id, auteur_identifiant, auteur_role, entite, enregistrement_id, action, avant, apres")
          .eq("etablissement_id", etablissementId)
          .order("cree_le", { ascending: false }).order("id", { ascending: false });
        if (entite) requete = requete.eq("entite", entite);
        if (action) requete = requete.eq("action", action);
        // Une ligne supplémentaire indique s'il existe une page suivante.
        const { data, error } = await requete.range(page * TAILLE_PAGE, (page + 1) * TAILLE_PAGE);
        if (error) throw error;
        if (actif) setEtat({ lignes: (data || []).slice(0, TAILLE_PAGE), suite: (data || []).length > TAILLE_PAGE, chargement: false, erreur: null });
      } catch (error) {
        if (actif) setEtat({ lignes: [], suite: false, chargement: false,
          erreur: ["42P01", "PGRST205"].includes(error.code) ? "audit_migration" : "audit_erreur" });
      }
    })();
    // Une réponse tardive ne doit jamais réafficher les données de l'ancien établissement.
    return () => { actif = false; };
  }, [client, etablissementId, entite, action, page, revision]);

  const actualiser = () => { setPage(0); setRevision(r => r + 1); };
  return (
    <section className="cc-page cc-audit" aria-labelledby="audit-titre">
      <div className="cc-card cc-audit-card">
        <header className="cc-audit-header">
          <div>
            <h1 id="audit-titre"><History size={21} aria-hidden="true" /> {t("nav_modifications")}</h1>
            <p>{t("audit_description")}</p>
          </div>
          <button type="button" onClick={actualiser} disabled={etat.chargement}>
            <RefreshCw size={15} aria-hidden="true" /> {t("audit_actualiser")}
          </button>
        </header>
        <p className="cc-audit-notice">{t("audit_notice")}</p>
        <div className="cc-audit-filtres">
          <label>{t("audit_domaine")}
            <select value={entite} onChange={e => { setEntite(e.target.value); setPage(0); }}>
              <option value="">{t("audit_tous_domaines")}</option>
              {ENTITES.map(e => <option key={e} value={e}>{t(`audit_entite_${e}`)}</option>)}
            </select>
          </label>
          <label>{t("audit_action")}
            <select value={action} onChange={e => { setAction(e.target.value); setPage(0); }}>
              <option value="">{t("audit_toutes_actions")}</option>
              {["INSERT", "UPDATE", "DELETE"].map(a => <option key={a} value={a}>{t(`audit_action_${a}`)}</option>)}
            </select>
          </label>
        </div>
        {etat.chargement ? <p role="status">{t("chargement")}</p> : etat.erreur ? (
          <div role="alert" className="cc-audit-message">
            <p>{t(etat.erreur)}</p>
            <button type="button" onClick={actualiser}>{t("audit_reessayer")}</button>
          </div>
        ) : etat.lignes.length === 0 ? (
          <p role="status" className="cc-audit-message">{t(entite || action ? "audit_vide_filtre" : "audit_vide")}</p>
        ) : (
          <ol className="cc-audit-liste">
            {etat.lignes.map(ligne => {
              const donnees = ligne.apres || ligne.avant || {};
              const titre = donnees.designation || donnees.nom || donnees.note || t(`audit_entite_${ligne.entite}`);
              const couleur = ligne.action === "DELETE" ? C.rouge : ligne.action === "INSERT" ? C.vert : C.or;
              return (
                <li key={ligne.id} className="cc-audit-evenement">
                  <div className="cc-audit-meta">
                    <span className="cc-audit-badge" style={{ color: couleur }}>{t(`audit_action_${ligne.action}`)}</span>
                    <span>{t(`audit_entite_${ligne.entite}`)}</span>
                    <time dateTime={ligne.cree_le}>{new Date(ligne.cree_le).toLocaleString(langue, { dateStyle: "medium", timeStyle: "medium" })}</time>
                  </div>
                  <h2>{titre}</h2>
                  <p className="cc-audit-auteur">
                    {t("audit_par")} {ligne.auteur_identifiant || ligne.auteur_id || t("audit_systeme")}
                    {ligne.auteur_role && <> · {t(`audit_role_${ligne.auteur_role}`)}</>}
                  </p>
                  <details>
                    <summary>{t("audit_details")}</summary>
                    <p className="cc-audit-reference">{t("audit_reference")} : {ligne.enregistrement_id}</p>
                    <div className="cc-audit-table-scroll">
                      <table>
                        <thead><tr><th scope="col">{t("audit_champ")}</th><th scope="col">{t("audit_avant")}</th><th scope="col">{t("audit_apres")}</th></tr></thead>
                        <tbody>{champsModifies(ligne).map(champ => (
                          <tr key={champ}>
                            <th scope="row">{t(`audit_champ_${champ}`)}</th>
                            <td>{valeurHistorique(ligne.avant?.[champ], champ, langue, t)}</td>
                            <td>{valeurHistorique(ligne.apres?.[champ], champ, langue, t)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
        {!etat.erreur && (
          <nav className="cc-audit-pagination" aria-label={t("audit_pagination")}>
            <button type="button" disabled={etat.chargement || page === 0} onClick={() => setPage(p => p - 1)}>{t("audit_precedent")}</button>
            <span>{t("audit_page", { nombre: page + 1 })}</span>
            <button type="button" disabled={etat.chargement || !etat.suite} onClick={() => setPage(p => p + 1)}>{t("audit_suivant")}</button>
          </nav>
        )}
      </div>
    </section>
  );
}
