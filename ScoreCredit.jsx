import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Award, Target, TrendingUp, Copy, MessageCircle, Info, Printer, History } from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { calculerScoreCredit, attestationScore, PALIERS } from "./creditScoring.js";
import { secteurNormalise, seuilsDuSecteur } from "./secteurs.js";
import { C, COULEURS_GRAPH } from "./theme.js";

const fmt = (n) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const fmtPct = (n) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)} %`);

/** Jauge circulaire du score. */
function Jauge({ score, palier }) {
  const rayon = 62;
  const circonference = 2 * Math.PI * rayon;
  const progression = (Math.min(100, Math.max(0, score)) / 100) * circonference;
  return (
    <div style={S.jaugeWrap}>
      <svg width="170" height="170" viewBox="0 0 170 170" role="img" aria-label={`Score ${score} sur 100`}>
        <circle cx="85" cy="85" r={rayon} fill="none" stroke={C.bord} strokeWidth="14" />
        <circle
          cx="85"
          cy="85"
          r={rayon}
          fill="none"
          stroke={palier.couleur}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${progression} ${circonference}`}
          transform="rotate(-90 85 85)"
        />
        <text
          x="85"
          y="80"
          textAnchor="middle"
          style={{ font: "700 40px 'Fraunces', serif", fill: C.texte }}
        >
          {score}
        </text>
        <text
          x="85"
          y="104"
          textAnchor="middle"
          style={{ font: "600 13px Inter, sans-serif", fill: C.texteDoux }}
        >
          /100
        </text>
      </svg>
      <span style={{ ...S.palierBadge, background: palier.couleur }}>
        {palier.id === "bronze" ? "BRONZE" : palier.id === "argent" ? "ARGENT" : "OR"}
      </span>
    </div>
  );
}

/**
 * Score de Crédit ComptaCi.
 * Transforme les données de gestion en un score présentable à une banque ou à
 * une institution de microfinance.
 */
/** Clé de mois « AAAA-MM » utilisée par l'historique. */
const cleMois = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const libelleMois = (periode) => {
  const [a, m] = String(periode || "").split("-");
  if (!a || !m) return periode || "—";
  const d = new Date(Number(a), Number(m) - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
};

export default function ScoreCredit({ transactions, etablissement, demandes = [], t, langue }) {
  const [copie, setCopie] = useState(false);
  const [historique, setHistorique] = useState([]);
  const [historiqueIndispo, setHistoriqueIndispo] = useState(false);
  const secteurActif = secteurNormalise(etablissement?.secteur);
  const seuils = seuilsDuSecteur(secteurActif);
  const seuilDepenses = (seuils.achats + seuils.personnel + seuils.charges) / 100;

  const resultat = useMemo(
    () =>
      calculerScoreCredit({
        transactions,
        etablissement,
        demandes,
        seuilDepenses,
      }),
    [transactions, etablissement, demandes, seuilDepenses]
  );

  const m = resultat.meta;

  // Charge l'historique mensuel (preuve de progression pour un prêteur).
  useEffect(() => {
    if (!supabase || !etablissement?.id) {
      setHistoriqueIndispo(true);
      return;
    }
    let annule = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("scores_credit")
          .select("periode, score, palier, objectifs_atteints, objectifs_total")
          .eq("etablissement_id", etablissement.id)
          .order("periode", { ascending: false })
          .limit(12);
        if (error) throw error;
        if (!annule) {
          setHistorique(data || []);
          setHistoriqueIndispo(false);
        }
      } catch (e) {
        // Table absente (migration non appliquée) : on prévient sans bloquer.
        if (!annule) setHistoriqueIndispo(true);
      }
    })();
    return () => {
      annule = true;
    };
  }, [etablissement?.id]);

  // Enregistre le point du mois en cours (un seul point par mois : upsert).
  useEffect(() => {
    if (!supabase || !etablissement?.id) return;
    let annule = false;
    (async () => {
      try {
        const { error } = await supabase.rpc("enregistrer_score_credit", {
          p_etablissement_id: etablissement.id,
          p_periode: cleMois(new Date()),
          p_score: resultat.score,
          p_palier: resultat.palier.id,
          p_objectifs_atteints: resultat.objectifsAtteints,
          p_objectifs_total: resultat.objectifsTotal,
          p_ca_90j: Math.round(m.caFenetre),
          p_depenses_90j: Math.round(m.depFenetre),
          p_regularite_pct: Math.round(m.regularitePct * 100) / 100,
          p_anciennete_jours: m.joursAnciennete,
          p_detail: JSON.stringify(resultat.criteres),
        });
        if (error) throw error;
        if (!annule) setHistoriqueIndispo(false);
      } catch (e) {
        if (!annule) setHistoriqueIndispo(true);
      }
    })();
    return () => {
      annule = true;
    };
  }, [etablissement?.id, resultat.score, resultat.objectifsAtteints, m.caFenetre, m.depFenetre]);

  const texteAttestation = () =>
    attestationScore({
      resultat,
      etablissement,
      secteurLabel: t(`secteur_${secteurActif}`),
    });

  const copierAttestation = async () => {
    try {
      await navigator.clipboard.writeText(texteAttestation());
      setCopie(true);
      setTimeout(() => setCopie(false), 2200);
    } catch (_) {
      setCopie(false);
    }
  };

  const partagerAttestation = () => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(texteAttestation())}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const imprimerAttestation = () => {
    const fenetre = window.open("", "_blank", "width=760,height=900");
    if (!fenetre) return;
    fenetre.document.write(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${t(
        "score_attestation_titre"
      )} — ${etablissement?.nom || ""}</title>` +
        `<style>body{font-family:Inter,system-ui,sans-serif;color:var(--cc-accent);padding:36px;line-height:1.6}` +
        `h1{font-family:Georgia,serif;font-size:22px;margin:0 0 18px}` +
        `pre{white-space:pre-wrap;font-family:Inter,system-ui,sans-serif;font-size:13px}</style></head>` +
        `<body><h1>${t("score_attestation_titre")}</h1><pre>${texteAttestation().replace(
          /</g,
          "&lt;"
        )}</pre></body></html>`
    );
    fenetre.document.close();
    fenetre.focus();
    fenetre.print();
  };

  return (
    <div className="cc-page cc-page-score" style={S.page}>
      {/* En-tête explicative */}
      <div style={S.introCard} className="cc-card">
        <div style={S.introIcon}>
          <Award size={20} color="var(--cc-or)" />
        </div>
        <div>
          <div style={S.introTitre}>{t("score_titre_long")}</div>
          <p style={S.introTexte}>{t("score_intro")}</p>
        </div>
      </div>

      <div style={S.scoreRow}>
        {/* Jauge + paliers */}
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("score_titre")}</div>
              <div style={S.cardCaption}>
                {t("score_sous_titre", { nom: etablissement?.nom || "—" })}
              </div>
            </div>
          </div>
          <Jauge score={resultat.score} palier={resultat.palier} />
          <div style={S.paliersRow}>
            {PALIERS.map((p) => {
              const actif = p.id === resultat.palier.id;
              return (
                <div
                  key={p.id}
                  style={{
                    ...S.palierChip,
                    ...(actif ? { borderColor: p.couleur, background: p.couleurFond } : {}),
                  }}
                >
                  <span style={{ ...S.palierPoint, background: p.couleur }} />
                  <span style={S.palierNom}>
                    {p.id === "bronze" ? "Bronze" : p.id === "argent" ? "Argent" : "Or"}
                  </span>
                  <span style={S.palierBornes}>
                    {p.min}–{p.max}
                  </span>
                </div>
              );
            })}
          </div>
          <p style={S.note}>{t("score_note_banque")}</p>
        </div>

        {/* Détail des 5 critères */}
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("score_criteres_titre")}</div>
              <div style={S.cardCaption}>{t("score_criteres_sous")}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
            {resultat.criteres.map((c) => (
              <div key={c.id}>
                <div style={S.critereHead}>
                  <span style={S.critereLabel}>{t(`score_critere_${c.id}`)}</span>
                  <span style={S.criterePoints}>
                    {c.points}/{c.max}
                  </span>
                </div>
                <div style={S.barTrack}>
                  <div
                    style={{
                      ...S.barFill,
                      width: `${(c.points / c.max) * 100}%`,
                      background:
                        c.points / c.max >= 0.75
                          ? "var(--cc-vert)"
                          : c.points / c.max >= 0.4
                          ? "var(--cc-or)"
                          : "var(--cc-rouge)",
                    }}
                  />
                </div>
                <div style={S.critereExplication}>{t(`score_critere_${c.id}_desc`)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Objectifs atteints */}
      <div style={S.card} className="cc-card">
        <div style={S.cardHeader}>
          <div>
            <div style={S.cardTitle}>{t("score_objectifs_titre")}</div>
            <div style={S.cardCaption}>
              {t("score_objectifs_sous")}
            </div>
          </div>
          <div style={S.cardMontant}>
            {resultat.objectifsAtteints}/{resultat.objectifsTotal}
          </div>
        </div>
        <div style={S.objectifsGrid}>
          {resultat.objectifs.map((o) => (
            <div
              key={o.id}
              style={{
                ...S.objectifCard,
                ...(o.atteint ? S.objectifCardOk : S.objectifCardKo),
              }}
            >
              <div style={S.objectifHead}>
                <span aria-hidden="true">{o.atteint ? "✅" : "◻️"}</span>
                <span style={S.objectifTitre}>{t(`score_objectif_${o.id}`)}</span>
              </div>
              <div style={S.objectifValeur}>
                {o.valeur === null
                  ? o.atteint
                    ? t("score_ok")
                    : t("score_non_rempli")
                  : `${fmt(o.valeur)}${o.unite}`}
                {o.cible !== null && o.cible !== undefined && (
                  <span style={S.objectifCible}>
                    {" "}
                    / {t("score_cible")} {fmt(o.cible)}
                    {o.unite}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Indicateurs + évolution */}
      <div style={S.scoreRow}>
        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("score_indicateurs_titre")}</div>
              <div style={S.cardCaption}>{t("score_indicateurs_sous")}</div>
            </div>
          </div>
          <div style={S.indicateursListe}>
            <Indicateur label={t("score_ind_ca")} valeur={`${fmt(m.caFenetre)} FCFA`} />
            <Indicateur label={t("score_ind_depenses")} valeur={`${fmt(m.depFenetre)} FCFA`} />
            <Indicateur
              label={t("score_ind_marge")}
              valeur={m.margePct === null ? "—" : `${m.margePct.toFixed(1)} %`}
            />
            <Indicateur
              label={t("score_ind_regularite")}
              valeur={`${m.joursAvecVentes}/${m.joursObserves} (${Math.round(m.regularitePct)} %)`}
            />
            <Indicateur label={t("score_ind_tendance")} valeur={fmtPct(m.tendancePct)} />
            <Indicateur label={t("score_ind_anciennete")} valeur={`${m.joursAnciennete} j`} />
          </div>
        </div>

        <div style={S.card} className="cc-card">
          <div style={S.cardHeader}>
            <div>
              <div style={S.cardTitle}>{t("score_evolution_titre")}</div>
              <div style={S.cardCaption}>{t("score_evolution_sous")}</div>
            </div>
          </div>
          <div style={{ height: 210, marginTop: 10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={resultat.evolution} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="caScore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.vert} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={C.vert} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.bord} vertical={false} />
                <XAxis
                  dataKey="mois"
                  tick={{ fontSize: 11, fill: C.texteDoux }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  formatter={(v) => `${fmt(v)} FCFA`}
                  contentStyle={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: 12,
                    border: "1px solid var(--cc-bord)",
                    borderRadius: 8,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="ca"
                  stroke={C.vert}
                  strokeWidth={2}
                  fill="url(#caScore)"
                  name={t("score_ind_ca")}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Historique du score : une progression vaut mieux qu'un chiffre isolé */}
      <div style={S.card} className="cc-card">
        <div style={S.cardHeader}>
          <div>
            <div style={S.cardTitle}>
              <History size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {t("score_historique_titre")}
            </div>
            <div style={S.cardCaption}>{t("score_historique_sous")}</div>
          </div>
        </div>
        {historiqueIndispo ? (
          <div style={S.vide}>{t("score_historique_erreur")}</div>
        ) : historique.length === 0 ? (
          <div style={S.vide}>{t("score_historique_vide")}</div>
        ) : (
          <div style={S.historiqueTable}>
            <div style={S.historiqueEntete}>
              <span>{t("score_historique_col_mois")}</span>
              <span>{t("score_historique_col_score")}</span>
              <span>{t("score_objectifs_titre")}</span>
            </div>
            {historique.map((h) => {
              const palier = PALIERS.find((p) => p.id === h.palier) || PALIERS[0];
              return (
                <div key={h.periode} style={S.historiqueLigne}>
                  <span style={S.historiqueMois}>{libelleMois(h.periode)}</span>
                  <span style={{ ...S.historiqueScore, color: palier.couleur }}>
                    {h.score}/100
                    <span style={S.historiquePalier}>
                      {h.palier === "bronze" ? "Bronze" : h.palier === "argent" ? "Argent" : "Or"}
                    </span>
                  </span>
                  <span style={S.historiqueObjectifs}>
                    {h.objectifs_atteints}/{h.objectifs_total}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Attestation */}
      <div style={S.card} className="cc-card">
        <div style={S.cardHeader}>
          <div>
            <div style={S.cardTitle}>{t("score_attestation_titre")}</div>
            <div style={S.cardCaption}>{t("score_attestation_sous")}</div>
          </div>
        </div>
        <pre style={S.attestation}>{texteAttestation()}</pre>
        <div style={S.attestationActions}>
          <button type="button" onClick={copierAttestation} style={S.btnPrimaire}>
            <Copy size={14} /> {copie ? t("score_attestation_copiee") : t("score_attestation_copier")}
          </button>
          <button type="button" onClick={partagerAttestation} style={S.btnSecondaire}>
            <MessageCircle size={14} /> {t("score_attestation_whatsapp")}
          </button>
          <button type="button" onClick={imprimerAttestation} style={S.btnSecondaire}>
            <Printer size={14} /> {t("score_attestation_imprimer")}
          </button>
        </div>
      </div>

      {/* Avertissement honnête sur la reconnaissance bancaire */}
      <div style={S.avertissement}>
        <Info size={15} />
        <p style={S.avertissementTexte}>{t("score_avertissement")}</p>
      </div>
    </div>
  );
}

function Indicateur({ label, valeur }) {
  return (
    <div style={S.indicateur}>
      <span style={S.indicateurLabel}>{label}</span>
      <strong style={S.indicateurValeur}>{valeur}</strong>
    </div>
  );
}

const S = {
  page: { display: "flex", flexDirection: "column", gap: 16, width: "100%" },
  introCard: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    background: "var(--cc-surface-3)",
    border: "1px solid var(--cc-or-pale)",
    borderRadius: 14,
    padding: "14px 16px",
  },
  introIcon: {
    flexShrink: 0,
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "var(--cc-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  introTitre: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "var(--cc-or-clair)" },
  introTexte: { margin: "4px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--cc-or-clair)" },
  scoreRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 },
  card: {
    background: "var(--cc-surface)",
    border: "1px solid var(--cc-bord)",
    borderRadius: 14,
    padding: 16,
  },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  cardTitle: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "var(--cc-texte)" },
  cardCaption: { fontSize: 12, color: "var(--cc-texte-doux)", marginTop: 3 },
  cardMontant: { fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, color: "var(--cc-texte)" },
  jaugeWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 10 },
  palierBadge: {
    color: "var(--cc-surface)",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    padding: "4px 14px",
    borderRadius: 20,
  },
  paliersRow: { display: "flex", gap: 8, justifyContent: "center", marginTop: 14, flexWrap: "wrap" },
  palierChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    border: "1px solid var(--cc-bord)",
    borderRadius: 20,
    fontSize: 11.5,
    color: "var(--cc-texte-corps)",
  },
  palierPoint: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  palierNom: { fontWeight: 600, color: "var(--cc-texte)" },
  palierBornes: { color: "var(--cc-texte-doux)" },
  note: { margin: "12px 0 0", fontSize: 11.5, color: "var(--cc-texte-doux)", lineHeight: 1.5 },
  critereHead: { display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 },
  critereLabel: { color: "var(--cc-texte)", fontWeight: 500 },
  criterePoints: { color: "var(--cc-texte-corps)", fontWeight: 700 },
  barTrack: { height: 8, borderRadius: 20, background: "var(--cc-surface-2)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 20 },
  critereExplication: { marginTop: 5, fontSize: 11.5, color: "var(--cc-texte-doux)", lineHeight: 1.45 },
  objectifsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 10,
    marginTop: 14,
  },
  objectifCard: { border: "1px solid var(--cc-bord)", borderRadius: 11, padding: "10px 12px" },
  objectifCardOk: { background: "var(--cc-vert-fond)", borderColor: "var(--cc-vert-bord)" },
  objectifCardKo: { background: "var(--cc-surface)" },
  objectifHead: { display: "flex", alignItems: "center", gap: 7 },
  objectifTitre: { fontSize: 12.5, fontWeight: 600, color: "var(--cc-texte)", lineHeight: 1.3 },
  objectifValeur: { marginTop: 6, fontSize: 12, color: "var(--cc-texte-corps)", fontWeight: 600 },
  objectifCible: { fontWeight: 400, color: "var(--cc-texte-doux)" },
  indicateursListe: { display: "flex", flexDirection: "column", gap: 10, marginTop: 12 },
  indicateur: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 8,
    borderBottom: "1px dashed var(--cc-bord)",
  },
  indicateurLabel: { fontSize: 12.5, color: "var(--cc-texte-corps)" },
  indicateurValeur: { fontSize: 13.5, color: "var(--cc-texte)" },
  attestation: {
    margin: "12px 0 0",
    padding: 14,
    background: "var(--cc-surface-2)",
    border: "1px solid var(--cc-bord)",
    borderRadius: 11,
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11.5,
    lineHeight: 1.6,
    color: "var(--cc-texte)",
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  },
  attestationActions: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" },
  btnPrimaire: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "var(--cc-degrade-or)",
    color: "var(--cc-texte-inverse)",
    fontSize: 13,
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
  vide: { marginTop: 12, fontSize: 12.5, color: "var(--cc-texte-doux)", lineHeight: 1.5 },
  historiqueTable: { marginTop: 12, display: "flex", flexDirection: "column", gap: 6 },
  historiqueEntete: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 8,
    fontSize: 11,
    fontWeight: 700,
    color: "var(--cc-texte-doux)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    paddingBottom: 4,
    borderBottom: "1px solid var(--cc-bord)",
  },
  historiqueLigne: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 8,
    alignItems: "center",
    padding: "7px 0",
    borderBottom: "1px dashed var(--cc-bord)",
  },
  historiqueMois: { fontSize: 12.5, color: "var(--cc-texte-corps)" },
  historiqueScore: { fontSize: 13, fontWeight: 700 },
  historiquePalier: {
    marginLeft: 6,
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--cc-texte-doux)",
  },
  historiqueObjectifs: { fontSize: 12.5, color: "var(--cc-texte-corps)" },
  avertissement: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    background: "var(--cc-bord)",
    border: "1px solid var(--cc-bord)",
    borderRadius: 12,
    padding: "12px 14px",
  },
  avertissementTexte: { margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--cc-texte-discret)" },
};
