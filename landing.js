import { supabase, configManquante } from "./supabaseClient.js";

async function afficherPlacesRestantes() {
  const el = document.getElementById("fondateur-slots");
  if (!el) return;
  if (configManquante || !supabase) {
    el.textContent = "Places limitées";
    return;
  }
  try {
    const { data, error } = await supabase.rpc("places_fondateurs_restantes");
    if (error || data == null) {
      el.textContent = "Places limitées";
      return;
    }
    el.textContent = data > 0
      ? `${data} place${data > 1 ? "s" : ""} restante${data > 1 ? "s" : ""} sur 100`
      : "Offre fondateurs complète — tarif normal désormais";
  } catch (e) {
    el.textContent = "Places limitées";
  }
}

afficherPlacesRestantes();
