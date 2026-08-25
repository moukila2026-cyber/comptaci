import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

// Le mot de passe reste géré par Supabase ; le téléphone sert d'identifiant
// en le transformant en une adresse email interne (gratuit, pas de SMS).
export function telephoneVersEmail(telephone) {
  const nettoye = telephone.replace(/\s|\+/g, "");
  return `${nettoye}@comptaci.app`;
}
