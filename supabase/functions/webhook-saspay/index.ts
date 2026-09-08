/**
 * webhook-saspay — Supabase Edge Function (Deno)
 * ============================================================================
 * Reçoit les notifications de paiement SasPay et active l'abonnement de
 * l'établissement sans intervention manuelle.
 *
 * SECRETS (déjà présents côté Supabase, à ne pas mettre dans le code) :
 *   SASPAY_WEBHOOK_SECRET      → clé HMAC partagée avec SasPay (déjà configurée)
 *   SUPABASE_URL               → fourni automatiquement par Supabase
 *   SUPABASE_SERVICE_ROLE_KEY  → fourni automatiquement par Supabase
 *
 * Variables facultatives :
 *   SASPAY_SIGNATURE_HEADER    → nom de l'en-tête de signature
 *                                (défaut : x-saspay-signature)
 *   SASPAY_DUREE_ABONNEMENT    → jours d'abonnement crédités (géré en SQL, 30)
 *
 * DÉPLOIEMENT :
 *   supabase secrets set SASPAY_WEBHOOK_SECRET=xxxxx
 *   supabase functions deploy webhook-saspay --no-verify-jwt
 *
 * URL À RENSEIGNER DANS LE TABLEAU DE BORD SASPAY :
 *   https://<project-ref>.supabase.co/functions/v1/webhook-saspay
 *
 * Contrat :
 *   - toute notification est journalisée dans `paiements_saspay` ;
 *   - l'activation passe par la RPC SQL `traiter_paiement_saspay` (idempotente :
 *     une même transaction n'est jamais comptée deux fois) ;
 *   - l'établissement est retrouvé par `business_id`, puis par la référence
 *     d'une demande en attente, puis par le préfixe « CCI-XXXXXX ».
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* ------------------------------------------------------------------ outils */

const SECRET = Deno.env.get("SASPAY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

/** En-têtes acceptés pour la signature (le 1er trouvé est utilisé). */
const HEADERS_SIGNATURE = (
  Deno.env.get("SASPAY_SIGNATURE_HEADER") ||
  "x-saspay-signature,saspay-signature,x-signature,signature,x-hub-signature-256"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const ENTETES_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-saspay-signature, saspay-signature, x-signature, signature",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...ENTETES_CORS, "Content-Type": "application/json" },
  });

/** HMAC-SHA256 du corps brut, en hexadécimal. */
async function hmacHex(secret: string, corps: string): Promise<string> {
  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(corps));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparaison à temps constant (évite les attaques temporelles). */
function comparer(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

async function verifierSignature(req: Request, corps: string) {
  if (!SECRET) return { valide: false, raison: "secret_absent" };

  const recue = (HEADERS_SIGNATURE.map((h) => req.headers.get(h)).find(Boolean) || "").trim();
  if (!recue) return { valide: false, raison: "signature_absente" };

  const attendue = await hmacHex(SECRET, corps);
  const normalisee = recue.replace(/^sha256=/i, "").trim().toLowerCase();
  return { valide: comparer(normalisee, attendue.toLowerCase()), raison: "comparee" };
}

/* --------------------------------------------------- lecture du payload */

type Payload = Record<string, unknown>;

const texte = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

function chercher(payload: Payload, ...cles: string[]): string {
  for (const cle of cles) {
    const valeur = payload[cle];
    if (valeur && typeof valeur !== "object") return texte(valeur);
  }
  for (const cle of ["metadata", "meta", "data", "custom", "transaction", "payment"]) {
    const imbrique = payload[cle];
    if (imbrique && typeof imbrique === "object") {
      const objet = imbrique as Payload;
      for (const sousCle of cles) {
        const valeur = objet[sousCle];
        if (valeur && typeof valeur !== "object") return texte(valeur);
      }
    }
  }
  return "";
}

const nombre = (v: unknown): number | null => {
  const n = Number(String(v ?? "").toString().replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const STATUTS_OK = [
  "success", "successful", "succeeded", "paid", "paye", "completed", "complete",
  "approved", "validated", "success_payment", "payment.success", "00", "ok", "true",
];
const STATUTS_KO = [
  "failed", "failure", "error", "declined", "refused", "cancelled", "canceled",
  "expired", "abandoned", "payment.failed", "01",
];

/** Le paiement est-il confirmé ? (statut explicite, ou booléens SasPay) */
function paiementReussi(payload: Payload): boolean {
  const statut = chercher(payload, "status", "statut", "event", "state", "transaction_status")
    .toLowerCase()
    .replace(/[.\s]+/g, "_");
  if (STATUTS_OK.includes(statut)) return true;
  if (STATUTS_KO.includes(statut)) return false;
  for (const cle of ["paid", "success", "is_success", "successful", "status_code"]) {
    const valeur = payload[cle];
    if (valeur === true || valeur === "true" || valeur === 1) return true;
    if (valeur === false || valeur === "false") return false;
  }
  return false;
}

/** Forfait annoncé, ou relu dans la référence « CCI-XXXXXX-AAAAMM-pro ». */
function planDuPayload(payload: Payload, reference: string): string | null {
  const brut = chercher(payload, "plan", "forfait", "item", "product", "offer").toLowerCase();
  if (["starter", "pro", "entreprise", "enterprise"].includes(brut)) {
    return brut === "enterprise" ? "entreprise" : brut;
  }
  const morceaux = reference.split("-");
  const dernier = (morceaux[morceaux.length - 1] || "").toLowerCase();
  if (["starter", "pro", "entreprise"].includes(dernier)) return dernier;
  return null;
}

/* --------------------------------------------------------------- service */

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ENTETES_CORS });

  if (req.method === "GET") {
    return json({
      ok: true,
      service: "webhook-saspay",
      secret_configure: Boolean(SECRET),
      supabase_configure: Boolean(SUPABASE_URL && SERVICE_ROLE_KEY),
    });
  }

  if (req.method !== "POST") return json({ ok: false, erreur: "methode_non_autorisee" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, erreur: "supabase_non_configure" }, 500);
  }

  const corps = await req.text();
  const signature = await verifierSignature(req, corps);

  if (!signature.valide) {
    console.warn("[saspay] signature invalide :", signature.raison);
    // 401 : SasPay pourra rejouer la notification si c'est un faux positif.
    return json({ ok: false, erreur: "signature_invalide", raison: signature.raison }, 401);
  }

  let payload: Payload = {};
  try {
    payload = corps ? (JSON.parse(corps) as Payload) : {};
  } catch (_) {
    return json({ ok: false, erreur: "json_invalide" }, 400);
  }

  const transactionId =
    chercher(payload, "transaction_id", "txn_id", "id", "payment_id", "ref", "reference") ||
    `saspay-${Date.now()}`;
  const reference = chercher(
    payload,
    "reference", "txn_ref", "transaction_ref", "order_id", "custom", "client_reference"
  );
  const montant = nombre(
    chercher(payload, "amount", "montant", "total", "amount_total", "value") || null
  );
  const devise = chercher(payload, "currency", "devise") || "XOF";
  const telephone = chercher(
    payload, "phone", "customer_phone", "payer_msisdn", "msisdn", "customer_phone_number"
  );
  const idEtablissement = chercher(
    payload, "business_id", "etablissement_id", "establishment_id", "businessId", "client_id"
  );
  const reussi = paiementReussi(payload);
  const evenement = chercher(payload, "event", "type", "status", "statut");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await admin.rpc("traiter_paiement_saspay", {
    p_transaction_id: transactionId,
    p_reference: reference || null,
    p_etablissement_id: /^[0-9a-f-]{36}$/i.test(idEtablissement) ? idEtablissement : null,
    p_plan: planDuPayload(payload, reference),
    p_montant: montant,
    p_devise: devise,
    p_telephone: telephone || null,
    p_reussi: reussi,
    p_evenement: evenement || null,
    p_signature_valide: true,
    p_payload: payload,
  });

  if (error) {
    console.error("[saspay] erreur SQL :", error.message);
    return json({ ok: false, erreur: error.message }, 500);
  }

  console.log("[saspay] traité :", transactionId, JSON.stringify(data));
  return json({ ok: true, ...(data ?? {}) }, 200);
});
