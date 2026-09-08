/**
 * Aperçu des nouveaux écrans ComptaCi avec des données fictives.
 * ---------------------------------------------------------------------------
 * Page de DÉVELOPPEMENT : elle n'est pas dans les entrées de build
 * (voir vite.config.js — seuls index.html et app.html sont construits).
 *
 *   npm run dev  →  http://localhost:5173/dev-preview/index.html
 */
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import ScoreCredit from "../ScoreCredit.jsx";
import FacturationFNE from "../FacturationFNE.jsx";
import { traducteur } from "../i18n.js";
import { Abonnement, Caisse, Dashboard, Historique, Saisie, Stock } from "../App.jsx";
import { SECTEURS_IDS, postesDuSecteur, posteDeDesignation } from "../secteurs.js";

const t = traducteur("fr");

/* ------------------------------------------------------------------ données */

const MAINTENANT = new Date("2026-09-08T10:00:00");
const jour = (i) => new Date(MAINTENANT.getTime() - i * 86400000).toISOString().slice(0, 10);

/** Une « boutique de Diallo » d'exemple : ventes régulières + achats réels. */
function faussesTransactions() {
  const tx = [];
  // 90 jours de ventes, avec un jour de fermeture hebdomadaire
  for (let i = 0; i < 90; i += 1) {
    if (i % 7 === 3) continue;
    tx.push({
      id: `v${i}`,
      type: "vente",
      montant: 95000 + ((i * 7919) % 45000),
      date: jour(i),
      designation: `Vente du ${jour(i)}`,
      quantite: 1,
      categorie: "vente",
    });
  }
  // Dépenses réparties sur les postes réels du type « boutique »
  postesDuSecteur("boutique").slice(0, 12).forEach((p, idx) => {
    for (let i = 0; i < 90; i += 9 + (idx % 5)) {
      tx.push({
        id: `d${idx}-${i}`,
        type: "depense",
        montant: 4000 + ((i * 3301) % 22000) + idx * 350,
        date: jour(i),
        designation: p.label,
        poste_id: p.id,
        quantite: 1,
        categorie: p.categorie,
      });
    }
  });
  return tx;
}

const TRANSACTIONS = faussesTransactions();

const ETABLISSEMENT = {
  id: "00000000-0000-4000-8000-000000000001",
  nom: "La boutique de Diallo",
  secteur: "boutique",
  plan: "pro",
  abonnement_actif: true,
  essai_jours: 14,
  date_creation: "2026-02-14T09:00:00Z",
  // Enrôlement FNE partiel : contribuable + RCCM saisis, clé API pas encore.
  fne_numero_contribuable: "1234567X",
  fne_rccm: "CI-ABJ-2021-B-04521",
  fne_cle_api: null,
};

/** Quelques références déjà en stock, pour illustrer l'alerte de seuil. */
const PRODUITS_DEMO = [
  { id: "p1", designation: "Biscuits", quantite_stock: 3, prix_unitaire: 250, seuil_alerte: 5 },
  { id: "p2", designation: "Savon", quantite_stock: 48, prix_unitaire: 350, seuil_alerte: 5 },
  { id: "p3", designation: "Eau de Javel", quantite_stock: 2, prix_unitaire: 500, seuil_alerte: 5 },
];

/* --------------------------------------------------------- écran : secteurs */

function ApercuSecteurs() {
  const [secteur, setSecteur] = useState("boutique");
  const postes = postesDuSecteur(secteur);

  const styles = {
    carte: { background: "var(--cc-surface)", border: "1px solid var(--cc-bord)", borderRadius: 14, padding: 16 },
    grille: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
      gap: 8,
      marginTop: 12,
    },
  };

  return (
    <div>
      <h2 style={{ fontFamily: "'Fraunces', serif", marginBottom: 12 }}>
        Menu déroulant « Créer un établissement » + dépenses types
      </h2>

      <label style={{ display: "block", marginBottom: 16, maxWidth: 420 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cc-texte-doux)" }}>
          {t("auth_secteur")}
        </span>
        <select
          value={secteur}
          onChange={(e) => setSecteur(e.target.value)}
          style={{
            marginTop: 6,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 9,
            border: "1px solid var(--cc-bord)",
            fontSize: 14,
            fontFamily: "'Inter', sans-serif",
            cursor: "pointer",
          }}
        >
          {SECTEURS_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`secteur_${id}`)}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: "#8A8578", display: "block", marginTop: 5 }}>
          {t("auth_secteur_aide", { nb: 20 })}
        </span>
      </label>

      <div style={styles.carte}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600 }}>
          {t("dash_postes_titre")} — {t(`secteur_${secteur}`)} ({postes.length}{" "}
          {t("dash_postes_unites")})
        </div>
        <div style={styles.grille}>
          {postes.map((p, i) => {
            const actif = i < 6;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 9,
                  border: `1px solid ${actif ? "var(--cc-or)" : "var(--cc-bord)"}`,
                  background: actif ? "var(--cc-surface-2)" : "var(--cc-surface)",
                }}
              >
                <span style={{ fontSize: 12 }}>{p.label}</span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: actif ? "#16213E" : "#A9A497",
                    whiteSpace: "nowrap",
                  }}
                >
                  {actif ? `${(9 - i) * 18} 500 F` : "—"}
                </span>
              </div>
            );
          })}
        </div>
        <p style={{ marginTop: 12, fontSize: 11.5, color: "#8A8578", lineHeight: 1.5 }}>
          {t("dash_postes_note")}
        </p>
      </div>

      <div style={{ marginTop: 16, fontSize: 12.5, color: "var(--cc-texte-doux)", lineHeight: 1.7 }}>
        <strong>Rattachement automatique d'une dépense à son poste :</strong>
        <br />
        « eau de javel » → {posteDeDesignation(secteur, "eau de javel")?.label || "non classé"}
        {" · "}
        « savon » → {posteDeDesignation(secteur, "savon")?.label || "non classé"}
        {" · "}
        « maggi » → {posteDeDesignation(secteur, "maggi")?.label || "non classé"}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- rendu */

const VUES = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "saisie", label: "Saisie" },
  { id: "caisse", label: "Caisse" },
  { id: "historique", label: "Historique" },
  { id: "score", label: "Score de crédit" },
  { id: "fne", label: "Facturation FNE" },
  { id: "secteurs", label: "Types d'établissement" },
  { id: "abonnement", label: "Abonnement / type" },
  { id: "stock", label: "Stock / import des postes" },
];

function Application() {
  const [vue, setVue] = useState("dashboard");

  return (
    <>
      <div className="onglets">
        {VUES.map((v) => (
          <button
            key={v.id}
            onClick={() => setVue(v.id)}
            className={vue === v.id ? "actif" : ""}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Les composants sont rendus dans le thème sombre de l'app (.cc-app) */}
      <div className="cc-app" style={{ paddingBottom: 40 }}>
        {vue === "dashboard" && (
          <Dashboard
            transactions={TRANSACTIONS}
            isMobile={false}
            secteur={ETABLISSEMENT.secteur}
            etablissement={ETABLISSEMENT}
            demandes={[]}
            t={t}
          />
        )}
        {vue === "saisie" && (
          <Saisie onAdd={async () => true} secteur={ETABLISSEMENT.secteur} etablissement={ETABLISSEMENT} t={t} />
        )}
        {vue === "caisse" && (
          <Caisse
            sessionCaisse={null}
            historiqueCaisse={[]}
            transactions={TRANSACTIONS}
            onOuvrir={async () => true}
            onFermer={async () => true}
            t={t}
          />
        )}
        {vue === "historique" && (
          <Historique
            transactions={TRANSACTIONS.slice(0, 40)}
            onDelete={async () => true}
            onUpdate={async () => true}
            plan="pro"
            secteur={ETABLISSEMENT.secteur}
            t={t}
          />
        )}
        {vue === "score" && (
          <ScoreCredit
          transactions={TRANSACTIONS}
          etablissement={ETABLISSEMENT}
          demandes={[]}
          t={t}
          langue="fr"
        />
      )}
      {vue === "fne" && (
        <FacturationFNE
          etablissement={ETABLISSEMENT}
          transactions={TRANSACTIONS}
          planEffectif="pro"
          enEssai={false}
          t={t}
        />
      )}
      {vue === "secteurs" && <ApercuSecteurs />}
      {vue === "stock" && (
        <Stock
          produits={PRODUITS_DEMO}
          secteur="boutique"
          t={t}
          onAdd={async () => true}
          onAjuster={async () => true}
          onSupprimer={async () => true}
          onSeuil={async () => true}
          onImporterPostes={async () => ({ ok: true, ajoutes: 27 })}
        />
      )}
      {vue === "abonnement" && (
        <Abonnement
          etablissement={ETABLISSEMENT}
          planEffectif="pro"
          enEssai={false}
          t={t}
          />
        )}
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Application />);
