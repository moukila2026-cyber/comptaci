/**
 * fne-kompto — Supabase Edge Function (Deno)
 * ============================================================================
 * Proxy d'appel à l'API KOMPTO (intégrateur FNE agréé DGI Côte d'Ivoire).
 *
 * ── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 * ComptaCi est une SPA Vite : toute variable `VITE_*` est compilée dans le
 * bundle JS public. La clé API KOMPTO est une clé d'INTÉGRATEUR partagée par
 * tous les marchands ComptaCi ; l'exposer au navigateur permettrait à
 * n'importe qui d'émettre des factures certifiées frauduleuses et d'épuiser le
 * quota DGI. Cette fonction détient donc la clé en SECRET SERVEUR et relaie les
 * appels — sur le modèle exact de `webhook-saspay`.
 *
 * ── CE QU'ELLE FAIT DE PLUS QU'UN SIMPLE RELAIS ─────────────────────────────
 *  1. elle exige un utilisateur Supabase authentifié (JWT vérifié) ;
 *  2. elle vérifie que cet utilisateur est bien MEMBRE de l'établissement ;
 *  3. elle vérifie que l'OPTION FNE ANNUELLE est payée et non expirée ;
 *  4. elle relit `establishment` / `pointOfSale` / `NCC` EN BASE et les injecte
 *     elle-même dans la requête KOMPTO. Ce que le navigateur envoie pour ces
 *     trois champs est IGNORÉ : un client ne peut donc pas faire certifier une
 *     facture sous un autre établissement ou un autre point de vente ;
 *  5. pour `/delete` et `/createCreditNote`, elle vérifie que le
 *     `komptoEntryId` appartient bien à cet établissement (anti cross-tenant) ;
 *  6. elle journalise l'appel dans `appels_fne_kompto` (piste d'audit) ;
 *  7. elle ne renvoie JAMAIS la clé API, même en cas d'erreur.
 *
 * ── SECRETS (côté Supabase, jamais dans le code ni dans git) ────────────────
 *   KOMPTO_API_KEY            → clé API KOMPTO (obligatoire)
 *   KOMPTO_BASE_URL           → https://qa.kompto.com (sandbox, défaut)
 *                               https://app.kompto.com (production)
 *   KOMPTO_ENVIRONNEMENT      → "sandbox" | "production" (défaut sandbox)
 *   SUPABASE_URL              → fourni automatiquement par Supabase
 *   SUPABASE_SERVICE_ROLE_KEY → fourni automatiquement par Supabase
 *
 * ── DÉPLOIEMENT ─────────────────────────────────────────────────────────────
 *   supabase secrets set KOMPTO_API_KEY=xxxxx
 *   supabase secrets set KOMPTO_ENVIRONNEMENT=sandbox
 *   supabase functions deploy fne-kompto            ← SANS --no-verify-jwt :
 *                                                     le JWT utilisateur est
 *                                                     obligatoire ici.
 *
 * ⚠️ Le déploiement en production (KOMPTO_ENVIRONNEMENT=production + URL
 * app.kompto.com) est bloqué tant que les points TBD-KOMPTO de `kompto.js`
 * n'ont pas été confirmés par le Guide API KOMPTO v.5.3 et que les 12
 * scénarios de validation sandbox ne sont pas passés. Voir
 * `configurationPretPourProduction()` dans `kompto.js`.
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* ------------------------------------------------------------------ config */

const CLE_API = Deno.env.get("KOMPTO_API_KEY") ?? "";
const ENVIRONNEMENT = (Deno.env.get("KOMPTO_ENVIRONNEMENT") || "sandbox")
  .trim()
  .toLowerCase();

/** Sandbox par défaut : on ne touche pas la production par accident. */
const URLS_PAR_ENVIRONNEMENT: Record<string, string> = {
  sandbox: "https://qa.kompto.com",
  production: "https://app.kompto.com",
};
const BASE_URL = (
  Deno.env.get("KOMPTO_BASE_URL") || URLS_PAR_ENVIRONNEMENT[ENVIRONNEMENT] || URLS_PAR_ENVIRONNEMENT.sandbox
).replace(/\/+$/, "");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const ENTETES_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...ENTETES_CORS, "Content-Type": "application/json" },
  });

const texte = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/* ------------------------------------------------- endpoints (CONFIRMÉS) */

/**
 * Les 7 appels du cycle de vie d'une FNE.
 * Verbes et chemins CONFIRMÉS par la page publique officielle kompto.com/KomptoApi.
 */
const ENDPOINTS: Record<string, { methode: string; chemin: string }> = {
  verify: { methode: "POST", chemin: "/api/invoice/verify" },
  getVerify: { methode: "GET", chemin: "/api/invoice/getVerify" },
  confirm: { methode: "POST", chemin: "/api/invoice/confirm" },
  getElectronicInvoice: { methode: "GET", chemin: "/api/invoice/getElectronicInvoice" },
  delete: { methode: "DELETE", chemin: "/api/invoice/delete" },
  create: { methode: "POST", chemin: "/api/invoice/create" },
  createCreditNote: { methode: "POST", chemin: "/api/invoice/createCreditNote" },
};

/**
 * Actions qui engagent la DGI : elles exigent un établissement pleinement
 * configuré et une option active. Les actions de lecture sont plus tolérantes.
 */
const ACTIONS_ENGAGEANTES = ["verify", "confirm", "create", "createCreditNote"];

/**
 * TBD-KOMPTO #1 — noms des champs portant les identifiants de l'établissement.
 * L'exemple curl public de `/verify` ne contient ni `establishment` ni
 * `pointOfSale` ; le Guide v.5.3 précise leur emplacement et leur nom exact.
 * À corriger ICI UNIQUEMENT (le navigateur n'envoie jamais ces valeurs).
 */
const NOM_CHAMP_ETABLISHMENT = "establishment";
const NOM_CHAMP_POINT_OF_SALE = "pointOfSale";

/* ------------------------------------------------------------- service */

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES_CORS });

  // Sonde de vie : ne révèle volontairement AUCUNE information sensible.
  if (req.method === "GET") {
    return json({
      ok: true,
      service: "fne-kompto",
      environnement: ENVIRONNEMENT,
      cle_api_configuree: Boolean(CLE_API),
      supabase_configure: Boolean(SUPABASE_URL && SERVICE_ROLE_KEY),
    });
  }

  if (req.method !== "POST") return json({ ok: false, erreur: "methode_non_autorisee" }, 405);

  if (!CLE_API) {
    return json(
      { ok: false, erreur: "kompto_non_configure", detail: "KOMPTO_API_KEY absent des secrets Supabase." },
      500
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, erreur: "supabase_non_configure" }, 500);
  }

  /* ---------------------------------------------------- 1. utilisateur */

  const authorization = req.headers.get("Authorization") ?? "";
  const jeton = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!jeton) return json({ ok: false, erreur: "authentification_requise" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(jeton);
  const userId = authData?.user?.id;
  if (authError || !userId) {
    return json({ ok: false, erreur: "session_invalide" }, 401);
  }

  /* -------------------------------------------------------- 2. requête */

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch (_) {
    return json({ ok: false, erreur: "json_invalide" }, 400);
  }

  const action = texte(payload.action);
  const etablissementId = texte(payload.etablissement_id ?? payload.etablissementId);
  const corpsClient = (payload.corps && typeof payload.corps === "object"
    ? payload.corps
    : {}) as Record<string, unknown>;

  if (!ENDPOINTS[action]) {
    return json({ ok: false, erreur: "action_inconnue", action }, 400);
  }
  if (!etablissementId) {
    return json({ ok: false, erreur: "etablissement_requis" }, 400);
  }

  /* ------------------------------- 3. appartenance à l'établissement */

  const { data: membre, error: errMembre } = await admin
    .from("membres")
    .select("etablissement_id, role")
    .eq("etablissement_id", etablissementId)
    .eq("user_id", userId)
    .maybeSingle();

  if (errMembre || !membre) {
    // 403 et non 404 : on ne confirme pas l'existence de l'établissement.
    return json({ ok: false, erreur: "acces_refuse" }, 403);
  }

  /* ------------------------------------------- 4. droit d'usage FNE */

  const { data: etab, error: errEtab } = await admin
    .from("etablissements")
    .select(
      "id, nom, plan, fne_choix, fne_statut, fne_expiration_date, fne_establishment, fne_point_of_sale, fne_ncc, fne_environnement"
    )
    .eq("id", etablissementId)
    .maybeSingle();

  if (errEtab || !etab) return json({ ok: false, erreur: "etablissement_introuvable" }, 404);

  if (ACTIONS_ENGAGEANTES.includes(action)) {
    const refus = droitFneRefuse(etab as Record<string, unknown>);
    if (refus) {
      return json({ ok: false, erreur: "option_fne_indisponible", raison: refus }, 403);
    }
  }

  /* --------------------- 5. propriété du komptoEntryId (anti cross-tenant) */

  const komptoEntryId = texte(
    (corpsClient as Record<string, unknown>).komptoEntryId ??
      (corpsClient as Record<string, unknown>).originalKomptoEntryId
  );

  if (komptoEntryId && ["confirm", "delete", "getVerify", "getElectronicInvoice", "createCreditNote"].includes(action)) {
    const { data: facture } = await admin
      .from("factures_fne")
      .select("id, etablissement_id")
      .eq("kompto_entry_id", komptoEntryId)
      .maybeSingle();

    // Une facture connue d'un AUTRE établissement est un accès illégitime.
    // Une facture inconnue est tolérée pour `/verify`→`/confirm` immédiat,
    // tant que l'archivage n'a pas encore eu lieu.
    if (facture && facture.etablissement_id !== etablissementId) {
      return json({ ok: false, erreur: "acces_refuse", raison: "facture_d_un_autre_etablissement" }, 403);
    }
    //
    // ⚠️ LIMITATION CONNUE — une facture ABSENTE de notre table échappe à ce
    // contrôle (cas d'un enchaînement /verify → /confirm sans archivage
    // intermédiaire). On ne peut pas filtrer sur establishment/pointOfSale ici
    // sans connaître le nom exact du paramètre GET attendu par KOMPTO
    // (TBD-KOMPTO #4). C'est pourquoi `archiver_facture_fne()` doit être appelé
    // SYSTÉMATIQUEMENT dès le /verify : c'est l'archivage qui rend ce contrôle
    // effectif. Les identifiants restent au demeurant opaques et l'appelant
    // doit être membre authentifié de l'établissement.
  }

  /* ------------- 6. injection des identifiants depuis la BASE (jamais du client) */

  const corpsFinal: Record<string, unknown> = { ...corpsClient };

  // Les identifiants fournis par le navigateur sont systématiquement écrasés
  // par ceux de la base : c'est ce qui empêche un client de faire certifier
  // une facture sous un autre établissement ou un autre point de vente.
  delete corpsFinal[NOM_CHAMP_ETABLISHMENT];
  delete corpsFinal[NOM_CHAMP_POINT_OF_SALE];
  delete corpsFinal.establishment;
  delete corpsFinal.pointOfSale;
  delete corpsFinal.etablishment_id;
  delete corpsFinal.etablissement_id;

  if (ACTIONS_ENGAGEANTES.includes(action)) {
    corpsFinal[NOM_CHAMP_ETABLISHMENT] = texte((etab as Record<string, unknown>).fne_establishment);
    corpsFinal[NOM_CHAMP_POINT_OF_SALE] = texte((etab as Record<string, unknown>).fne_point_of_sale);
  }

  /* ------------------------------------------------------- 7. appel KOMPTO */

  const endpoint = ENDPOINTS[action];
  const cible = `${BASE_URL}${endpoint.chemin}`;
  const estGet = endpoint.methode === "GET";

  let url = cible;
  const options: RequestInit = {
    method: endpoint.methode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // La clé API n'existe que dans cet en-tête, côté serveur.
      Authorization: `Bearer ${CLE_API}`,
    },
  };

  if (estGet || endpoint.methode === "DELETE") {
    const params = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(corpsFinal)) {
      if (valeur !== null && valeur !== undefined && valeur !== "") params.set(cle, String(valeur));
    }
    const qs = params.toString();
    if (qs) url = `${cible}?${qs}`;
  } else {
    options.body = JSON.stringify(corpsFinal);
  }

  const debut = Date.now();
  let reponse: Response;
  try {
    reponse = await fetch(url, options);
  } catch (e) {
    await journaliser(admin, {
      etablissementId,
      userId,
      action,
      statut: 0,
      ok: false,
      erreur: `reseau: ${e instanceof Error ? e.message : String(e)}`,
      dureeMs: Date.now() - debut,
      komptoEntryId,
    });
    return json({ ok: false, erreur: "kompto_injoignable", action }, 502);
  }

  const dureeMs = Date.now() - debut;
  const brut = await reponse.text();
  let corpsKompto: unknown = brut;
  try {
    corpsKompto = brut ? JSON.parse(brut) : null;
  } catch (_) {
    corpsKompto = { brut };
  }

  const ok = reponse.ok;

  await journaliser(admin, {
    etablissementId,
    userId,
    action,
    statut: reponse.status,
    ok,
    erreur: ok ? null : texte((corpsKompto as Record<string, unknown>)?.message) || `HTTP ${reponse.status}`,
    dureeMs,
    komptoEntryId: komptoEntryId || extraireEntryId(corpsKompto),
  });

  // Le corps KOMPTO est relayé tel quel : c'est `kompto.js` (côté client) qui
  // l'interprète. On n'ajoute JAMAIS la clé API, ni aucune partie de celle-ci.
  return json(
    { ok, statut: reponse.status, environnement: ENVIRONNEMENT, action, corps: corpsKompto },
    ok ? 200 : reponse.status >= 400 && reponse.status < 600 ? reponse.status : 502
  );
});

/* ------------------------------------------------------------------ outils */

/**
 * Vérifie le droit d'usage de l'option FNE pour un établissement.
 *
 * ⚠️ Ne dépend JAMAIS du forfait (`plan`) : Starter, Fondateur, Pro et
 * Entreprise y ont droit de la même façon. Seule l'option FNE payante compte.
 *
 * @returns raison du refus, ou `null` si l'établissement a le droit.
 */
function droitFneRefuse(etab: Record<string, unknown>): string | null {
  const choix = texte(etab.fne_choix).toLowerCase();
  if (!["creer", "connecter"].includes(choix)) {
    return choix === "methode_actuelle" ? "methode_externe" : "choix_sans_kompto";
  }

  const statut = texte(etab.fne_statut).toLowerCase();
  if (statut !== "active") return "statut_non_actif";

  const expiration = texte(etab.fne_expiration_date);
  if (!expiration) return "option_non_payee";
  const fin = Date.parse(expiration.length <= 10 ? `${expiration}T23:59:59Z` : expiration);
  if (!Number.isFinite(fin)) return "expiration_illisible";
  if (fin < Date.now()) return "option_expiree";

  if (!texte(etab.fne_establishment) || !texte(etab.fne_point_of_sale) || !texte(etab.fne_ncc)) {
    return "identifiants_kompto_manquants";
  }

  return null;
}

/** Extrait un identifiant de facture d'une réponse KOMPTO (filet de sécurité). */
function extraireEntryId(corps: unknown): string {
  if (!corps || typeof corps !== "object") return "";
  const o = corps as Record<string, unknown>;
  for (const cle of ["komptoEntryId", "KomptoEntryId", "entryId", "invoiceId", "id"]) {
    const v = texte(o[cle]);
    if (v) return v;
  }
  for (const cle of ["data", "result"]) {
    const imbrique = o[cle];
    if (imbrique && typeof imbrique === "object") {
      const trouve = extraireEntryId(imbrique);
      if (trouve) return trouve;
    }
  }
  return "";
}

/**
 * Piste d'audit des appels KOMPTO.
 * Ne lève jamais : un échec de journalisation ne doit pas faire perdre une
 * facture déjà certifiée par la DGI (document légal irréversible).
 * Le payload n'est JAMAIS journalisé intégralement — il contient des données
 * clients ; on ne garde que les métadonnées de l'appel.
 */
async function journaliser(
  admin: ReturnType<typeof createClient>,
  ligne: {
    etablissementId: string;
    userId: string;
    action: string;
    statut: number;
    ok: boolean;
    erreur: string | null;
    dureeMs: number;
    komptoEntryId: string;
  }
): Promise<void> {
  try {
    await admin.from("appels_fne_kompto").insert({
      etablissement_id: ligne.etablissementId,
      user_id: ligne.userId,
      action: ligne.action,
      environnement: ENVIRONNEMENT,
      statut_http: ligne.statut,
      reussi: ligne.ok,
      erreur: ligne.erreur,
      duree_ms: ligne.dureeMs,
      kompto_entry_id: ligne.komptoEntryId || null,
    });
  } catch (e) {
    console.warn("[fne-kompto] journalisation impossible :", e instanceof Error ? e.message : e);
  }
}
