import React, { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Award, Target, TrendingUp, Copy, MessageCircle, Info, Printer } from "lucide-react";
import { calculerScoreCredit, attestationScore, PALIERS } from "./creditScoring.js";
import { secteurNormalise, seuilsDuSecteur } from "./secteurs.js";

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
        <circle cx="85" cy="85" r={rayon} fill="none" stroke="#EDE7DA" strokeWidth="14" />
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
          style={{ font: "700 40px 'Fraunces', serif", fill: "#16213E" }}
        >
          {score}
        </text>
        <text
          x="85"
          y="104"
          textAnchor="middle"
          style={{ font: "600 13px Inter, sans-serif", fill: "#8A8578" }}
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
export default function ScoreCredit({ transactions, etablissement, t, langue }) {
  const [copie, setCopie] = useState(false);
  const secteurActif = secteurNormalise(etablissement?.secteur);
  const seuils = seuilsDuSecteur(secteurActif);
  const seuilDepenses = (seuils.achats + seuils.personnel + seuils.charges) / 100;

  const resultat = useMemo(
    () =>
      calculerScoreCredit({
        transactions,
        etablissement,
        seuilDepenses,
      }),
    [transactions, etablissement, seuilDepenses]
  );

  const m = resultat.meta;

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
        `<style>body{font-family:Inter,system-ui,sans-serif;color:#16213E;padding:36px;line-height:1.6}` +
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
    <div style={S.page}>
      {/* En-tête explicative */}
      <div style={S.introCard}>
        <div style={S.introIcon}>
          <Award size={20} color="#B4801F" />
        </div>
        <div>
          <div style={S.introTitre}>{t("score_titre_long")}</div>
          <p style={S.introTexte}>{t("score_intro")}</p>
        </div>
      </div>

      <div style={S.scoreRow}>
        {/* Jauge + paliers */}
        <div style={S.card}>
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
        <div style={S.card}>
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
                          ? "#186B4E"
                          : c.points / c.max >= 0.4
                          ? "#D4A24C"
                          : "#C1502E",
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
      <div style={S.card}>
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
        <div style={S.card}>
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

        <div style={S.card}>
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
                    <stop offset="0%" stopColor="#186B4E" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#186B4E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EDE7DA" vertical={false} />
                <XAxis
                  dataKey="mois"
                  tick={{ fontSize: 11, fill: "#8A8578" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  formatter={(v) => `${fmt(v)} FCFA`}
                  contentStyle={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: 12,
                    border: "1px solid #EDE7DA",
                    borderRadius: 8,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="ca"
                  stroke="#186B4E"
                  strokeWidth={2}
                  fill="url(#caScore)"
                  name={t("score_ind_ca")}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Attestation */}
      <div style={S.card}>
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
    background: "#FBF3E2",
    border: "1px solid #E5C88C",
    borderRadius: 14,
    padding: "14px 16px",
  },
  introIcon: {
    flexShrink: 0,
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "#FFFEFB",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  introTitre: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "#8A6420" },
  introTexte: { margin: "4px 0 0", fontSize: 13, lineHeight: 1.55, color: "#8A6420" },
  scoreRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 },
  card: {
    background: "#FFFEFB",
    border: "1px solid #EDE7DA",
    borderRadius: 14,
    padding: 16,
  },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  cardTitle: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "#16213E" },
  cardCaption: { fontSize: 12, color: "#8A8578", marginTop: 3 },
  cardMontant: { fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, color: "#16213E" },
  jaugeWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 10 },
  palierBadge: {
    color: "#FFFEFB",
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
    border: "1px solid #EDE7DA",
    borderRadius: 20,
    fontSize: 11.5,
    color: "#5C5748",
  },
  palierPoint: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  palierNom: { fontWeight: 600, color: "#16213E" },
  palierBornes: { color: "#8A8578" },
  note: { margin: "12px 0 0", fontSize: 11.5, color: "#8A8578", lineHeight: 1.5 },
  critereHead: { display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 },
  critereLabel: { color: "#16213E", fontWeight: 500 },
  criterePoints: { color: "#5C5748", fontWeight: 700 },
  barTrack: { height: 8, borderRadius: 20, background: "#F1ECE2", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 20 },
  critereExplication: { marginTop: 5, fontSize: 11.5, color: "#8A8578", lineHeight: 1.45 },
  objectifsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 10,
    marginTop: 14,
  },
  objectifCard: { border: "1px solid #EDE7DA", borderRadius: 11, padding: "10px 12px" },
  objectifCardOk: { background: "#E7F5EF", borderColor: "#B7E0CC" },
  objectifCardKo: { background: "#FFFEFB" },
  objectifHead: { display: "flex", alignItems: "center", gap: 7 },
  objectifTitre: { fontSize: 12.5, fontWeight: 600, color: "#16213E", lineHeight: 1.3 },
  objectifValeur: { marginTop: 6, fontSize: 12, color: "#5C5748", fontWeight: 600 },
  objectifCible: { fontWeight: 400, color: "#8A8578" },
  indicateursListe: { display: "flex", flexDirection: "column", gap: 10, marginTop: 12 },
  indicateur: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 8,
    borderBottom: "1px dashed #EDE7DA",
  },
  indicateurLabel: { fontSize: 12.5, color: "#5C5748" },
  indicateurValeur: { fontSize: 13.5, color: "#16213E" },
  attestation: {
    margin: "12px 0 0",
    padding: 14,
    background: "#FBF9F4",
    border: "1px solid #EDE7DA",
    borderRadius: 11,
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 11.5,
    lineHeight: 1.6,
    color: "#3A3628",
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  },
  attestationActions: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" },
  btnPrimaire: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 14px",
    borderRadius: 9,
    border: "none",
    background: "#16213E",
    color: "#F3D9A0",
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
    border: "1px solid #D4A24C",
    background: "transparent",
    color: "#8A6420",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  avertissement: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    background: "#EEF1F5",
    border: "1px solid #D5DCE4",
    borderRadius: 12,
    padding: "12px 14px",
  },
  avertissementTexte: { margin: 0, fontSize: 12, lineHeight: 1.55, color: "#4A5567" },
};
