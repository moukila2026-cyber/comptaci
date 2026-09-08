import React, { useEffect, useMemo, useState } from "react";
import { FileText, ShieldCheck, AlertTriangle, Copy, Printer, MessageCircle, Lock, Settings2 } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import {
  etatEnrolement,
  construireFacture,
  transmettreFacture,
  archiverFacture,
  chargerFactures,
  texteFacture,
  urlVerification,
  urlQrVerification,
  FNE_DUREE_ARCHIVAGE_ANS,
} from "./fne.js";

const fmt = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

/** Plans donnant accès à la facturation normalisée. */
const PLANS_FNE = ["pro", "entreprise"];

/**
 * Facturation FNE (facture normalisée électronique DGI).
 * Fonctionnalité réservée aux plans Pro et Entreprise : l'enjeu fiscal pour le
 * client est réel, et l'intégration suppose un enrôlement DGI abouti.
 */
export default function FacturationFNE({ etablissement, transactions, planEffectif, enEssai, t, onRafraichirEtablissement }) {
  const aAcces = PLANS_FNE.includes(planEffectif) || enEssai;
  const etat = etatEnrolement(etablissement);

  const [onglet, setOnglet] = useState("enrolement");
  const [formulaire, setFormulaire] = useState({
    fne_numero_contribuable: etablissement?.fne_numero_contribuable || "",
    fne_rccm: etablissement?.fne_rccm || "",
    fne_cle_api: etablissement?.fne_cle_api || "",
  });
  const [enregistrement, setEnregistrement] = useState(false);
  const [message, setMessage] = useState(null);
  const [factures, setFactures] = useState([]);
  const [generationEnCours, setGenerationEnCours] = useState(null);
  const [factureActive, setFactureActive] = useState(null);

  useEffect(() => {
    setFormulaire({
      fne_numero_contribuable: etablissement?.fne_numero_contribuable || "",
      fne_rccm: etablissement?.fne_rccm || "",
      fne_cle_api: etablissement?.fne_cle_api || "",
    });
  }, [etablissement?.id, etablissement?.fne_numero_contribuable, etablissement?.fne_rccm, etablissement?.fne_cle_api]);

  useEffect(() => {
    if (!aAcces || !etablissement?.id) return;
    chargerFactures(etablissement.id).then(setFactures);
  }, [aAcces, etablissement?.id]);

  // Ventes récentes pouvant donner lieu à une facture normalisée
  const ventesRecentes = useMemo(
    () =>
      (transactions || [])
        .filter((tx) => tx.type === "vente")
        .slice(0, 30),
    [transactions]
  );

  const enregistrerEnrolement = async () => {
    if (!supabase) {
      setMessage({ type: "ko", texte: t("fne_erreur_migration") });
      return;
    }
    if (!etablissement?.id) return;
    setEnregistrement(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("etablissements")
        .update({
          fne_numero_contribuable: formulaire.fne_numero_contribuable.trim() || null,
          fne_rccm: formulaire.fne_rccm.trim() || null,
          fne_cle_api: formulaire.fne_cle_api.trim() || null,
        })
        .eq("id", etablissement.id);
      if (error) throw error;
      setMessage({ type: "ok", texte: t("fne_enregistre_ok") });
      onRafraichirEtablissement?.();
    } catch (e) {
      const msg = String(e?.message || e);
      setMessage({
        type: "ko",
        texte: /fne_|does not exist|schema cache/i.test(msg)
          ? t("fne_erreur_migration")
          : t("fne_erreur_enregistrement"),
      });
    } finally {
      setEnregistrement(false);
    }
  };

  const genererFacture = async (vente) => {
    if (!etablissement?.id) return;
    setGenerationEnCours(vente.id || "manuel");
    setMessage(null);
    try {
      const facture = construireFacture({
        vente,
        etablissement,
        sequence: (factures?.length || 0) + 1,
      });
      const transmission = await transmettreFacture({ etablissement, vente, facture });
      const archive = await archiverFacture({ etablissement, vente, facture, transmission });

      // En mode certifié, on reprend le numéro normé renvoyé par la DGI.
      const numeroDgi = transmission?.donnees?.numero || transmission?.donnees?.numero_norme;
      const factureFinale = numeroDgi ? { ...facture, numero: numeroDgi, certifie: true } : facture;

      setFactureActive({ ...factureFinale, vente });

      if (transmission.ok) {
        setMessage({ type: "ok", texte: t("fne_transmise_ok") });
      } else if (transmission.erreur === "api_non_configuree") {
        setMessage({ type: "info", texte: t("fne_brouillon_ok") });
      } else {
        setMessage({ type: "ko", texte: t("fne_transmission_ko") });
      }
      setFactures(await chargerFactures(etablissement.id));
      if (!archive.ok) {
        console.warn("FNE — archivage impossible :", archive.erreur);
      }
    } catch (e) {
      console.error("FNE — génération :", e);
      setMessage({ type: "ko", texte: t("fne_erreur_generation") });
    } finally {
      setGenerationEnCours(null);
    }
  };

  const imprimerFacture = (f) => {
    const fenetre = window.open("", "_blank", "width=760,height=900");
    if (!fenetre) return;
    const qr = urlQrVerification(f.numero);
    const corps = texteFacture({ etablissement, facture: f, certifie: Boolean(f.certifie) })
      .replace(/</g, "&lt;");
    fenetre.document.write(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${t(
        "fne_titre"
      )} — ${f.numero}</title>` +
        `<style>body{font-family:'Courier New',monospace;color:var(--cc-accent);padding:32px;font-size:13px;line-height:1.5}` +
        `pre{white-space:pre-wrap;font-family:'Courier New',monospace;font-size:12.5px}` +
        `img{margin-top:12px}</style></head><body><pre>${corps}</pre>` +
        (qr ? `<img src="${qr}" alt="QR de vérification" width="150" height="150" />` : "") +
        `</body></html>`
    );
    fenetre.document.close();
    fenetre.focus();
    fenetre.print();
  };

  const partagerFacture = (f) => {
    const texte = texteFacture({ etablissement, facture: f, certifie: Boolean(f.certifie) });
    window.open(`https://wa.me/?text=${encodeURIComponent(texte)}`, "_blank", "noopener,noreferrer");
  };

  /* ------------------------------------------------------------------ accès */
  if (!aAcces) {
    return (
      <div className="cc-page cc-page-fne" style={S.page}>
        <div style={S.verrouCard} className="cc-card">
          <Lock size={22} color="var(--cc-or)" />
          <div>
            <div style={S.verrouTitre}>{t("fne_reserve_pro")}</div>
            <p style={S.verrouTexte}>{t("fne_reserve_pro_texte")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-page cc-page-fne" style={S.page}>
      {/* Rappel du cadre légal */}
      <div style={S.cadreCard} className="cc-card">
        <ShieldCheck size={18} color="var(--cc-vert)" />
        <div>
          <div style={S.cadreTitre}>{t("fne_cadre_titre")}</div>
          <p style={S.cadreTexte}>{t("fne_cadre_texte")}</p>
        </div>
      </div>

      {/* Onglets */}
      <div style={S.onglets}>
        <button
          type="button"
          onClick={() => setOnglet("enrolement")}
          style={{ ...S.onglet, ...(onglet === "enrolement" ? S.ongletActif : {}) }}
        >
          <Settings2 size={14} /> {t("fne_onglet_enrolement")}
        </button>
        <button
          type="button"
          onClick={() => setOnglet("generation")}
          style={{ ...S.onglet, ...(onglet === "generation" ? S.ongletActif : {}) }}
        >
          <FileText size={14} /> {t("fne_onglet_generation")}
        </button>
        <button
          type="button"
          onClick={() => setOnglet("archive")}
          style={{ ...S.onglet, ...(onglet === "archive" ? S.ongletActif : {}) }}
        >
          <Copy size={14} /> {t("fne_onglet_archive")} ({factures.length})
        </button>
      </div>

      {message && (
        <div
          style={{
            ...S.message,
            ...(message.type === "ok"
              ? S.messageOk
              : message.type === "ko"
              ? S.messageKo
              : S.messageInfo),
          }}
        >
          {message.texte}
        </div>
      )}

      {/* --------------------------------------------------------- enrôlement */}
      {onglet === "enrolement" && (
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("fne_enrolement_titre")}</div>
              <div style={S.cardCaption}>{t("fne_enrolement_sous")}</div>
            </div>
            <span
              style={{
                ...S.statutBadge,
                background: etat.pretPourApi ? "var(--cc-vert-fond)" : etat.enrole ? "var(--cc-surface-3)" : "var(--cc-rouge-fond)",
                color: etat.pretPourApi ? "var(--cc-vert)" : etat.enrole ? "var(--cc-or-clair)" : "var(--cc-rouge)",
              }}
            >
              {etat.pretPourApi ? t("fne_statut_certifie") : etat.enrole ? t("fne_statut_partiel") : t("fne_statut_brouillon")}
            </span>
          </div>

          <ol style={S.etapes}>
            <li>{t("fne_etape_1")}</li>
            <li>{t("fne_etape_2")}</li>
            <li>{t("fne_etape_3")}</li>
          </ol>

          <div style={S.form}>
            <label style={S.field}>
              <span style={S.label}>{t("fne_numero_contribuable")}</span>
              <input
                type="text"
                value={formulaire.fne_numero_contribuable}
                onChange={(e) => setFormulaire({ ...formulaire, fne_numero_contribuable: e.target.value })}
                placeholder={t("fne_numero_contribuable_placeholder")}
                style={S.input}
              />
            </label>
            <label style={S.field}>
              <span style={S.label}>{t("fne_rccm")}</span>
              <input
                type="text"
                value={formulaire.fne_rccm}
                onChange={(e) => setFormulaire({ ...formulaire, fne_rccm: e.target.value })}
                placeholder={t("fne_rccm_placeholder")}
                style={S.input}
              />
            </label>
            <label style={S.field}>
              <span style={S.label}>
                {t("fne_cle_api")} <span style={S.optionnel}>{t("fne_optionnel")}</span>
              </span>
              <input
                type="password"
                value={formulaire.fne_cle_api}
                onChange={(e) => setFormulaire({ ...formulaire, fne_cle_api: e.target.value })}
                placeholder={t("fne_cle_api_placeholder")}
                style={S.input}
              />
            </label>
            <button
              type="button"
              onClick={enregistrerEnrolement}
              disabled={enregistrement}
              style={S.btnPrimaire}
            >
              {enregistrement ? t("fne_enregistrement") : t("fne_enregistrer")}
            </button>
          </div>

          <div style={S.avertissement}>
            <AlertTriangle size={15} />
            <p style={S.avertissementTexte}>{t("fne_enrolement_note")}</p>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- génération */}
      {onglet === "generation" && (
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("fne_generation_titre")}</div>
              <div style={S.cardCaption}>{t("fne_generation_sous")}</div>
            </div>
          </div>

          {ventesRecentes.length === 0 ? (
            <div style={S.vide}>{t("fne_aucune_vente")}</div>
          ) : (
            <div style={S.listeVentes}>
              {ventesRecentes.map((v) => (
                <div key={v.id} style={S.ligneVente}>
                  <div>
                    <div style={S.venteDesignation}>{v.designation || t("fne_vente_sans_nom")}</div>
                    <div style={S.venteMeta}>
                      {v.date} · {fmt(v.montant)} FCFA
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => genererFacture(v)}
                    disabled={generationEnCours === (v.id || "manuel")}
                    style={S.btnPetit}
                  >
                    {generationEnCours === (v.id || "manuel") ? t("fne_generation_encours") : t("fne_generer")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {factureActive && (
            <div style={S.factureApercu}>
              <div style={S.cardHeader}>
                <div>
                  <div style={S.cardTitle}>{t("fne_apercu_titre")}</div>
                  <div style={S.cardCaption}>
                    {factureActive.certifie ? t("fne_statut_certifie") : t("fne_statut_brouillon")}
                  </div>
                </div>
              </div>
              <pre style={S.preFacture}>
                {texteFacture({
                  etablissement,
                  facture: factureActive,
                  certifie: Boolean(factureActive.certifie),
                })}
              </pre>
              {urlQrVerification(factureActive.numero) && (
                <img
                  src={urlQrVerification(factureActive.numero)}
                  alt={t("fne_qr_alt")}
                  width={140}
                  height={140}
                  style={{ marginTop: 10, border: "1px solid var(--cc-bord)", borderRadius: 8 }}
                />
              )}
              <div style={S.attestationActions}>
                <button type="button" onClick={() => imprimerFacture(factureActive)} style={S.btnSecondaire}>
                  <Printer size={14} /> {t("fne_imprimer")}
                </button>
                <button type="button" onClick={() => partagerFacture(factureActive)} style={S.btnSecondaire}>
                  <MessageCircle size={14} /> {t("fne_partager")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ archive */}
      {onglet === "archive" && (
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("fne_archive_titre")}</div>
              <div style={S.cardCaption}>
                {t("fne_archive_sous", { ans: FNE_DUREE_ARCHIVAGE_ANS })}
              </div>
            </div>
          </div>
          {factures.length === 0 ? (
            <div style={S.vide}>{t("fne_archive_vide")}</div>
          ) : (
            <div style={S.listeVentes}>
              {factures.map((f) => (
                <div key={f.id || f.numero} style={S.ligneVente}>
                  <div>
                    <div style={S.venteDesignation}>{f.numero}</div>
                    <div style={S.venteMeta}>
                      {f.date_emission} · {fmt(f.montant_ttc)} FCFA ·{" "}
                      <span
                        style={{
                          color: f.statut === "certifiee" ? "var(--cc-vert)" : "var(--cc-or-clair)",
                          fontWeight: 700,
                        }}
                      >
                        {f.statut === "certifiee" ? t("fne_statut_certifie") : t("fne_statut_brouillon")}
                      </span>
                    </div>
                    {urlVerification(f.numero) && (
                      <a
                        href={urlVerification(f.numero)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={S.lienVerif}
                      >
                        {t("fne_verifier")}
                      </a>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => imprimerFacture({ ...f, lignes: f.lignes || [] })}
                      style={S.btnPetit}
                    >
                      <Printer size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => partagerFacture({ ...f, lignes: f.lignes || [] })}
                      style={S.btnPetit}
                    >
                      <MessageCircle size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  page: { display: "flex", flexDirection: "column", gap: 14, width: "100%" },
  card: { background: "var(--cc-surface)", border: "1px solid var(--cc-bord)", borderRadius: 14, padding: 16 },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  cardTitle: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "var(--cc-texte)" },
  cardCaption: { fontSize: 12, color: "var(--cc-texte-doux)", marginTop: 3 },
  cadreCard: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    background: "var(--cc-vert-fond)",
    border: "1px solid var(--cc-vert-bord)",
    borderRadius: 12,
    padding: "12px 14px",
  },
  cadreTitre: { fontFamily: "'Fraunces', serif", fontSize: 14.5, fontWeight: 600, color: "var(--cc-vert)" },
  cadreTexte: { margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--cc-vert)" },
  verrouCard: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    background: "var(--cc-surface-3)",
    border: "1px solid var(--cc-or-pale)",
    borderRadius: 12,
    padding: "14px 16px",
  },
  verrouTitre: { fontFamily: "'Fraunces', serif", fontSize: 15.5, fontWeight: 600, color: "var(--cc-or-clair)" },
  verrouTexte: { margin: "4px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--cc-or-clair)" },
  avertissement: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    background: "var(--cc-rouge-fond)",
    border: "1px solid var(--cc-rouge-bord)",
    borderRadius: 10,
    padding: "10px 12px",
    marginTop: 12,
  },
  avertissementTexte: { margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--cc-rouge)" },
  onglets: { display: "flex", gap: 8, flexWrap: "wrap" },
  onglet: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 13px",
    borderRadius: 20,
    border: "1px solid var(--cc-bord)",
    background: "var(--cc-surface)",
    color: "var(--cc-texte-corps)",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  ongletActif: { background: "var(--cc-accent)", color: "var(--cc-or-clair)", borderColor: "var(--cc-or-bord)" },
  statutBadge: { fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20 },
  etapes: { margin: "12px 0 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: "var(--cc-texte-corps)" },
  form: { display: "flex", flexDirection: "column", gap: 12, marginTop: 14 },
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
  btnPrimaire: {
    padding: "12px 0",
    borderRadius: 10,
    border: "none",
    background: "var(--cc-degrade-or)",
    color: "var(--cc-texte-inverse)",
    boxShadow: "var(--cc-ombre-or)",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  btnSecondaire: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 14px",
    borderRadius: 9,
    border: "1px solid var(--cc-or)",
    background: "transparent",
    color: "var(--cc-or-clair)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  btnPetit: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 11px",
    borderRadius: 8,
    border: "1px solid var(--cc-bord)",
    background: "var(--cc-surface)",
    color: "var(--cc-texte)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  listeVentes: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
  ligneVente: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--cc-bord)",
    borderRadius: 10,
    background: "var(--cc-surface-2)",
    flexWrap: "wrap",
  },
  venteDesignation: { fontSize: 13, fontWeight: 600, color: "var(--cc-texte)" },
  venteMeta: { fontSize: 11.5, color: "var(--cc-texte-doux)", marginTop: 3 },
  lienVerif: { fontSize: 11.5, color: "var(--cc-or)", textDecoration: "underline" },
  vide: { marginTop: 12, fontSize: 12.5, color: "var(--cc-texte-doux)" },
  factureApercu: {
    marginTop: 16,
    padding: 14,
    border: "1px dashed var(--cc-or)",
    borderRadius: 12,
    background: "var(--cc-surface)",
  },
  preFacture: {
    margin: "10px 0 0",
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11.5,
    lineHeight: 1.55,
    color: "var(--cc-texte)",
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  },
  attestationActions: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" },
  message: { padding: "10px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5 },
  messageOk: { background: "var(--cc-vert-fond)", border: "1px solid var(--cc-vert-bord)", color: "var(--cc-vert)" },
  messageKo: { background: "var(--cc-rouge-fond)", border: "1px solid var(--cc-rouge-bord)", color: "var(--cc-rouge)" },
  messageInfo: { background: "var(--cc-surface-3)", border: "1px solid var(--cc-or-pale)", color: "var(--cc-or-clair)" },
};
