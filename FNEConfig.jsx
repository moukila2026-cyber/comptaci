/**
 * FNEConfig.jsx — Configuration FNE par établissement (Partie 1)
 * ----------------------------------------------------------------
 * Question :
 *   "Avez-vous déjà un compte FNE actif auprès de la DGI ?"  ○ Oui  ○ Non
 *
 * Si Non :
 *   ○ Créer une FNE → parcours KOMPTO (établissement + PdV) — nécessite
 *     l'option payante 100k FCFA/an (https://link.saspay.me/ikoziclmohm)
 *   ○ Ne pas créer de FNE → compta normale, 0 coût
 *
 * Si Oui :
 *   ○ Connecter cette FNE via KOMPTO → form establishment / pointOfSale / NCC
 *   ○ Garder sa méthode actuelle → compta interne sans lien
 *
 * La facturation certifiée n'est débloquée que quand fne_statut === 'active'.
 * Voir supabase-fne-option.sql (fne_statut + fne_expiration_date).
 */
import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { configKompto } from "./fne.js";
import { KOMPTO_DEFAULTS } from "./kompto.js";
import { checkApiKey } from "./kompto.js";
import PaiementFNE from "./PaiementFNE.jsx";

const STATUTS = {
  aucune: { label: "Aucune FNE", couleur: "var(--cc-texte-doux)", fond: "var(--cc-surface-2)" },
  en_cours: { label: "En cours — attente connexion KOMPTO", couleur: "var(--cc-or-clair)", fond: "var(--cc-surface-3)" },
  active: { label: "Active — facturation certifiée débloquée", couleur: "var(--cc-vert)", fond: "var(--cc-vert-fond)" },
  expiree: { label: "Expirée — renouvellement requis", couleur: "var(--cc-rouge)", fond: "var(--cc-rouge-fond)" },
};

function badgeStatut(statut) {
  const s = STATUTS[statut] || STATUTS.aucune;
  return (
    <span style={{ ...S.badge, background: s.fond, color: s.couleur, borderColor: s.couleur }}>
      {s.label}
    </span>
  );
}

export default function FNEConfig({ etablissement, t, onRafraichir }) {
  const cfg = configKompto(etablissement);
  const statut = etablissement?.fne_statut || (etablissement?.fne_active ? "active" : "aucune");
  const expiration = etablissement?.fne_expiration_date || null;

  // Choix du questionnaire (préremplis si déjà configuré)
  const hasKompto = Boolean(etablissement?.kompto_api_key || cfg.apiKey);
  const hasFneAlready = hasKompto || statut === "active" || statut === "en_cours";

  const [dejaCompte, setDejaCompte] = useState(hasFneAlready ? "oui" : "");
  const [choixNon, setChoixNon] = useState("");
  const [choixOui, setChoixOui] = useState(hasFneAlready ? "connecter" : "");
  const [form, setForm] = useState({
    kompto_api_key: etablissement?.kompto_api_key || "",
    kompto_etablissement: etablissement?.kompto_etablissement || cfg.establishment || KOMPTO_DEFAULTS.establishment,
    kompto_point_de_vente: etablissement?.kompto_point_de_vente || cfg.pointOfSale || KOMPTO_DEFAULTS.pointOfSale,
    fne_ncc: etablissement?.fne_ncc || etablissement?.fne_numero_contribuable || "",
    kompto_base_url: etablissement?.kompto_base_url || cfg.baseUrl || KOMPTO_DEFAULTS.baseUrl,
  });
  const [save, setSave] = useState(false);
  const [msg, setMsg] = useState(null);
  const [test, setTest] = useState({ loading: false, result: null });

  useEffect(() => {
    const c = configKompto(etablissement);
    setForm({
      kompto_api_key: etablissement?.kompto_api_key || "",
      kompto_etablissement: etablissement?.kompto_etablissement || c.establishment || KOMPTO_DEFAULTS.establishment,
      kompto_point_de_vente: etablissement?.kompto_point_de_vente || c.pointOfSale || KOMPTO_DEFAULTS.pointOfSale,
      fne_ncc: etablissement?.fne_ncc || etablissement?.fne_numero_contribuable || "",
      kompto_base_url: etablissement?.kompto_base_url || c.baseUrl || KOMPTO_DEFAULTS.baseUrl,
    });
  }, [etablissement?.id]);

  const estCheminKompto = (dejaCompte === "non" && choixNon === "creer") || (dejaCompte === "oui" && choixOui === "connecter");
  const estSansFne = (dejaCompte === "non" && choixNon === "ne_pas_creer") || (dejaCompte === "oui" && choixOui === "garder");

  const enregistrerSansFne = async () => {
    setSave(true);
    setMsg(null);
    try {
      const { error } = await supabase
        .from("etablissements")
        .update({ fne_statut: "aucune", fne_expiration_date: null })
        .eq("id", etablissement.id);
      if (error) throw error;
      setMsg({ type: "ok", texte: "Préférence enregistrée — cet établissement reste en compta normale sans FNE." });
      onRafraichir?.();
    } catch (e) {
      setMsg({ type: "ko", texte: String(e.message || e) });
    } finally {
      setSave(false);
    }
  };

  const enregistrerKompto = async () => {
    if (!etablissement?.id) return;
    if (!form.fne_ncc.trim()) {
      setMsg({ type: "ko", texte: "NCC requis (CNPS : 7 chiffres + 1 lettre majuscule, ex: 1234567A). Le NCC est le numéro de contribuable DGI." });
      return;
    }
    if (!/^[0-9]{7}[A-Z]$/.test(form.fne_ncc.trim())) {
      setMsg({ type: "ko", texte: "Format NCC invalide — 7 chiffres suivis d'une majuscule (ex: 1234567A)." });
      return;
    }
    setSave(true);
    setMsg(null);
    try {
      const payload = {
        kompto_api_key: form.kompto_api_key.trim() || null,
        kompto_base_url: form.kompto_base_url.trim() || KOMPTO_DEFAULTS.baseUrl,
        kompto_etablissement: form.kompto_etablissement.trim() || KOMPTO_DEFAULTS.establishment,
        kompto_point_de_vente: form.kompto_point_de_vente.trim() || KOMPTO_DEFAULTS.pointOfSale,
        fne_ncc: form.fne_ncc.trim(),
        fne_numero_contribuable: form.fne_ncc.trim(),
        // ne pas écraser fne_statut ici : il reste piloté par le webhook/paiment.
        // Mais si aucune échéance et statut aucune, on peut passer en en_cours après paiement.
      };
      const { error } = await supabase.from("etablissements").update(payload).eq("id", etablissement.id);
      if (error) throw error;

      // Si l'option est déjà payée (en_cours) et que la clé est posée, on peut proposer le passage en active
      if ((etablissement.fne_statut === "en_cours" || statut === "en_cours") && payload.kompto_api_key) {
        // test rapide de clé
        const chk = await checkApiKey({ baseUrl: payload.kompto_base_url, apiKey: payload.kompto_api_key });
        if (chk.status === 404 || chk.ok) {
          // clé acceptée → on marque active si l'échéance est encore valide
          await supabase.rpc("confirmer_fne_active", { p_etablissement_id: etablissement.id });
        }
      }

      setMsg({ type: "ok", texte: "Coordonnées KOMPTO enregistrées. Si votre option FNE est payée, la facturation certifiée sera débloquée." });
      onRafraichir?.();
    } catch (e) {
      setMsg({ type: "ko", texte: String(e.message || e) });
    } finally {
      setSave(false);
    }
  };

  const testerCle = async () => {
    const baseUrl = form.kompto_base_url.trim() || KOMPTO_DEFAULTS.baseUrl;
    const apiKey = form.kompto_api_key.trim();
    if (!apiKey) {
      setTest({ loading: false, result: { ok: false, message: "Collez d'abord votre clé API KOMPTO." } });
      return;
    }
    setTest({ loading: true, result: null });
    const res = await checkApiKey({ baseUrl, apiKey });
    if (res.status === 401) setTest({ loading: false, result: { ok: false, message: "401 — Clé invalide (Bearer)." } });
    else if (res.status === 404) setTest({ loading: false, result: { ok: true, message: "404 « La commande n'existe pas. » — clé acceptée (auth OK)." } });
    else setTest({ loading: false, result: { ok: res.ok, message: `HTTP ${res.status} — ${JSON.stringify(res.body)?.slice(0, 200)}` } });
  };

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div>
          <div style={S.titre}>Option FNE — Facture Normalisée Électronique (DGI)</div>
          <div style={S.sous}>100 000 FCFA/an par établissement · via KOMPTO · disponible sur tous les plans</div>
        </div>
        {badgeStatut(statut)}
      </div>

      {expiration && (
        <div style={S.expiration}>
          Échéance : <strong>{new Date(expiration).toLocaleDateString("fr-FR")}</strong>
          {statut === "expiree" && " — la certification est coupée jusqu'au renouvellement."}
          {statut === "active" && new Date(expiration) - new Date() < 15 * 86400000 && " — renouvellement bientôt dû."}
        </div>
      )}

      {statut === "expiree" && (
        <div style={S.alerte}>
          Votre option FNE est expirée : les factures ne peuvent plus être certifiées. Renouvelez l'option (100 000 FCFA/an) puis reconnectez votre clé KOMPTO.
        </div>
      )}

      <div style={S.questionBox}>
        <div style={S.qLabel}>Avez-vous déjà un compte FNE actif auprès de la DGI ?</div>
        <div style={S.radios}>
          <label style={{ ...S.radio, ...(dejaCompte === "oui" ? S.radioActif : {}) }}>
            <input type="radio" name="fne-deja" value="oui" checked={dejaCompte === "oui"} onChange={() => setDejaCompte("oui")} /> Oui
          </label>
          <label style={{ ...S.radio, ...(dejaCompte === "non" ? S.radioActif : {}) }}>
            <input type="radio" name="fne-deja" value="non" checked={dejaCompte === "non"} onChange={() => setDejaCompte("non")} /> Non
          </label>
        </div>

        {dejaCompte === "non" && (
          <div style={S.sousChoix}>
            <label style={{ ...S.radioLarge, ...(choixNon === "creer" ? S.radioActif : {}) }}>
              <input type="radio" name="fne-non" value="creer" checked={choixNon === "creer"} onChange={() => setChoixNon("creer")} />
              <span>
                <strong>Créer une FNE</strong> — création du compte FNE, de l'établissement et du point de vente par KOMPTO. Option payante 100k/an.
              </span>
            </label>
            <label style={{ ...S.radioLarge, ...(choixNon === "ne_pas_creer" ? S.radioActif : {}) }}>
              <input type="radio" name="fne-non" value="ne_pas_creer" checked={choixNon === "ne_pas_creer"} onChange={() => setChoixNon("ne_pas_creer")} />
              <span>
                <strong>Ne pas créer de FNE</strong> — établissement géré normalement (compta, TVA, rapports), <em>aucun coût supplémentaire</em>.
              </span>
            </label>
          </div>
        )}

        {dejaCompte === "oui" && (
          <div style={S.sousChoix}>
            <label style={{ ...S.radioLarge, ...(choixOui === "connecter" ? S.radioActif : {}) }}>
              <input type="radio" name="fne-oui" value="connecter" checked={choixOui === "connecter"} onChange={() => setChoixOui("connecter")} />
              <span>
                <strong>Connecter cette FNE à comptaCI via KOMPTO</strong> — vous possédez déjà un compte FNE ; on le relie via établissement / pointOfSale / NCC.
              </span>
            </label>
            <label style={{ ...S.radioLarge, ...(choixOui === "garder" ? S.radioActif : {}) }}>
              <input type="radio" name="fne-oui" value="garder" checked={choixOui === "garder"} onChange={() => setChoixOui("garder")} />
              <span>
                <strong>Garder sa méthode actuelle</strong> — compta interne uniquement, sans lien FNE (pas de certification).
              </span>
            </label>
          </div>
        )}

        {estSansFne && (
          <div style={S.encartOk}>
            <p style={S.encartTexte}>Aucun coût supplémentaire. Vous pourrez activer la FNE plus tard depuis ce panneau.</p>
            <button type="button" onClick={enregistrerSansFne} disabled={save} style={S.btnPrimaire}>
              {save ? "Enregistrement…" : "Confirmer — sans FNE"}
            </button>
          </div>
        )}

        {estCheminKompto && (
          <div style={S.encartKompto}>
            <div style={S.encartTitre}>Parcours KOMPTO — option FNE 100 000 FCFA/an</div>
            <p style={S.hint}>
              L'option est facturée d'avance pour 1 an (coût KOMPTO 80 000 FCFA, marge 20 000). Après paiement, renseignez ci-dessous
              votre <code style={S.code}>establishment</code> / <code style={S.code}>pointOfSale</code> / <code style={S.code}>NCC</code> tels
              qu'enrôlés sur la plateforme FNE (sensibles à la casse). Sandbox partagé : <code style={S.code}>PROGICI SARL / SIEGE</code>.
            </p>

            {(statut === "aucune" || statut === "expiree") && (
              <PaiementFNE etablissement={etablissement} t={t} compact onPaye={() => onRafraichir?.()} />
            )}

            {statut === "en_cours" && (
              <div style={S.infoEnCours}>
                Paiement reçu — statut <strong>en_cours</strong>. Renseignez la clé KOMPTO ci-dessous pour passer en <em>active</em>.
              </div>
            )}

            <div style={S.form}>
              <label style={S.field}>
                <span style={S.label}>Clé API KOMPTO (Bearer, UUID)</span>
                <input
                  type="password"
                  value={form.kompto_api_key}
                  onChange={(e) => setForm({ ...form, kompto_api_key: e.target.value })}
                  placeholder="UUID communiqué par KOMPTO"
                  style={S.input}
                />
              </label>
              <div style={S.twoCol}>
                <label style={S.field}>
                  <span style={S.label}>baseUrl KOMPTO</span>
                  <input type="text" value={form.kompto_base_url} onChange={(e) => setForm({ ...form, kompto_base_url: e.target.value })} style={S.input} placeholder="https://qa.kompto.com" />
                </label>
                <button type="button" onClick={testerCle} disabled={test.loading} style={S.btnGhost}>
                  {test.loading ? "Test…" : "Tester la clé"}
                </button>
              </div>
              {test.result && <div style={{ ...S.message, ...(test.result.ok ? S.msgOk : S.msgKo) }}>{test.result.message}</div>}

              <div style={S.twoCol}>
                <label style={S.field}>
                  <span style={S.label}>establishment (DGI)</span>
                  <input type="text" value={form.kompto_etablissement} onChange={(e) => setForm({ ...form, kompto_etablissement: e.target.value })} style={S.input} placeholder="PROGICI SARL" />
                </label>
                <label style={S.field}>
                  <span style={S.label}>pointOfSale</span>
                  <input type="text" value={form.kompto_point_de_vente} onChange={(e) => setForm({ ...form, kompto_point_de_vente: e.target.value })} style={S.input} placeholder="SIEGE" />
                </label>
              </div>
              <label style={S.field}>
                <span style={S.label}>NCC — Numéro de Compte Contribuable (CNPS)</span>
                <input type="text" value={form.fne_ncc} onChange={(e) => setForm({ ...form, fne_ncc: e.target.value })} style={S.input} placeholder="1234567A (7 chiffres + majuscule)" maxLength={8} />
                <span style={S.hintSmall}>7 chiffres + 1 lettre majuscule, ex : 0827331B. Utilisé pour B2B et l'enrôlement DGI.</span>
              </label>

              <button type="button" onClick={enregistrerKompto} disabled={save} style={S.btnPrimaire}>
                {save ? "Enregistrement…" : "Enregistrer la connexion KOMPTO"}
              </button>
            </div>
          </div>
        )}
      </div>

      {msg && <div style={{ ...S.message, ...(msg.type === "ok" ? S.msgOk : S.msgKo) }}>{msg.texte}</div>}

      <div style={S.aide}>
        <strong>Tarifs inchangés :</strong> Fondateur 7 000 · Pro 10 000 · Entreprise 20 000 FCFA/mois.
        FNE en supplément : 100 000 FCFA/an/établissement, par SasPay (Wave/OM/MTN/Moov/carte). Renouvellement annuel manuel via ce panneau.
      </div>
    </div>
  );
}

const S = {
  wrap: { display: "flex", flexDirection: "column", gap: 12 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" },
  titre: { fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "var(--cc-texte)" },
  sous: { fontSize: 12.5, color: "var(--cc-texte-doux)", marginTop: 3 },
  expiration: { fontSize: 12.5, color: "var(--cc-texte-corps)", background: "var(--cc-surface-2)", border: "1px solid var(--cc-bord)", borderRadius: 9, padding: "8px 11px" },
  alerte: { fontSize: 12.5, color: "var(--cc-rouge)", background: "var(--cc-rouge-fond)", border: "1px solid var(--cc-rouge-bord)", borderRadius: 9, padding: "10px 11px", lineHeight: 1.5 },
  badge: { fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20, border: "1px solid" },
  questionBox: { background: "var(--cc-surface)", border: "1px solid var(--cc-bord)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 14 },
  qLabel: { fontSize: 13.5, fontWeight: 700, color: "var(--cc-texte)" },
  radios: { display: "flex", gap: 12, flexWrap: "wrap" },
  radio: { display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 20, border: "1px solid var(--cc-bord)", background: "var(--cc-surface-2)", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  radioLarge: { display: "flex", alignItems: "flex-start", gap: 9, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cc-bord)", background: "var(--cc-surface-2)", fontSize: 12.5, lineHeight: 1.45, cursor: "pointer" },
  radioActif: { borderColor: "var(--cc-or)", background: "var(--cc-surface-3)", color: "var(--cc-or-clair)" },
  sousChoix: { display: "flex", flexDirection: "column", gap: 9 },
  encartOk: { background: "var(--cc-vert-fond)", border: "1px solid var(--cc-vert-bord)", borderRadius: 10, padding: "12px 14px" },
  encartKompto: { background: "var(--cc-surface-2)", border: "1px dashed var(--cc-or)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 },
  encartTitre: { fontSize: 12.5, fontWeight: 700, color: "var(--cc-or-clair)" },
  encartTexte: { fontSize: 12.5, color: "var(--cc-texte-corps)", margin: "0 0 8px", lineHeight: 1.5 },
  hint: { fontSize: 12, color: "var(--cc-texte-doux)", lineHeight: 1.5 },
  hintSmall: { fontSize: 11, color: "var(--cc-texte-doux)", lineHeight: 1.4 },
  code: { fontFamily: "ui-monospace, monospace", fontSize: 11.5, background: "var(--cc-surface-3)", padding: "1px 5px", borderRadius: 4 },
  infoEnCours: { fontSize: 12.5, color: "var(--cc-or-clair)", background: "var(--cc-surface-3)", border: "1px solid var(--cc-or-pale)", borderRadius: 8, padding: "8px 11px" },
  form: { display: "flex", flexDirection: "column", gap: 11 },
  field: { display: "flex", flexDirection: "column", gap: 5, flex: 1 },
  label: { fontSize: 12.5, fontWeight: 600, color: "var(--cc-texte-corps)" },
  input: { padding: "10px 12px", borderRadius: 9, border: "1px solid var(--cc-bord)", fontSize: 14, fontFamily: "'Inter', sans-serif", color: "var(--cc-texte)", outline: "none", background: "var(--cc-surface)" },
  twoCol: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" },
  btnPrimaire: { padding: "11px 16px", borderRadius: 10, border: "none", background: "var(--cc-degrade-or)", color: "var(--cc-texte-inverse)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif" },
  btnGhost: { padding: "10px 14px", borderRadius: 9, border: "1px solid var(--cc-or)", background: "transparent", color: "var(--cc-or-clair)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  message: { padding: "10px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.5 },
  msgOk: { background: "var(--cc-vert-fond)", border: "1px solid var(--cc-vert-bord)", color: "var(--cc-vert)" },
  msgKo: { background: "var(--cc-rouge-fond)", border: "1px solid var(--cc-rouge-bord)", color: "var(--cc-rouge)" },
  aide: { fontSize: 11.5, color: "var(--cc-texte-doux)", lineHeight: 1.5, background: "var(--cc-surface-2)", border: "1px solid var(--cc-bord)", borderRadius: 9, padding: "9px 11px" },
};
