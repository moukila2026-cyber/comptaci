import { createClient } from "@supabase/supabase-js";

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Nettoyage défensif : espaces, guillemets ou retours à la ligne collés par erreur
const url = (rawUrl || "").trim().replace(/^["']|["']$/g, "");
const key = (rawKey || "").trim().replace(/^["']|["']$/g, "");

const urlValide = /^https:\/\/.+\.[a-z0-9-]+\.supabase\.co\/?$/.test(url);

export const configManquante = !url || !urlValide || !key;

// Diagnostic précis affiché à l'utilisateur si la configuration est absente.
export const erreursConfig = [];
if (!url) {
  erreursConfig.push("VITE_SUPABASE_URL est absente");
} else if (!urlValide) {
  erreursConfig.push("VITE_SUPABASE_URL n'est pas une URL Supabase valide (attendu : https://xxxx.supabase.co)");
}
if (!key) {
  erreursConfig.push("VITE_SUPABASE_ANON_KEY est absente");
}

let client = null;
if (!configManquante) {
  try {
    client = createClient(url, key);
  } catch (e) {
    client = null;
  }
}
export const supabase = client;
export const clientEnErreur = !configManquante && client === null;

// Le mot de passe reste géré par Supabase ; le téléphone sert d'identifiant
// en le transformant en une adresse email interne (gratuit, pas de SMS).
export function telephoneVersEmail(telephone) {
  const nettoye = telephone.replace(/\s|\+/g, "");
  return `${nettoye}@comptaci.app`;
}
