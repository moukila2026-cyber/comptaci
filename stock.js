/**
 * Logique du stock, sans React ni accès direct à la base : l'application et
 * les tests utilisent les mêmes règles.
 *
 * Règle métier : seul le propriétaire gère les produits du stock. Les ventes
 * et dépenses saisies par un gérant ajustent les quantités des produits déjà
 * suivis, via la fonction SQL `appliquer_mouvement_stock` (voir
 * supabase-stock-proprietaire.sql). La base refuse toute écriture directe.
 */

/**
 * Traduit une vente ou une dépense en paramètres pour `appliquer_mouvement_stock`.
 * Renvoie null lorsque le mouvement ne touche pas le stock : désignation vide,
 * quantité nulle ou négative, type inconnu.
 */
export function parametresMouvementStock({ designation, quantite, type, prixUnitaire = 0 }) {
  const nom = String(designation ?? "").trim();
  const quantiteNumerique = parseFloat(quantite) || 0;
  const prix = parseFloat(prixUnitaire) || 0;
  if (!nom || quantiteNumerique <= 0) return null;
  if (type !== "vente" && type !== "depense") return null;
  return {
    p_designation: nom,
    p_quantite: quantiteNumerique,
    p_type: type,
    p_prix_unitaire: prix > 0 ? prix : null,
  };
}

/**
 * Applique un mouvement au stock côté base.
 * Renvoie `{ ok: true, produit }` (produit null si aucune ligne n'est concernée)
 * ou `{ ok: false, erreur }` avec l'erreur renvoyée par Supabase.
 */
export async function appliquerMouvementStock(client, etablissementId, mouvement) {
  const parametres = parametresMouvementStock(mouvement);
  if (!parametres) return { ok: true, produit: null };
  const { data, error } = await client.rpc("appliquer_mouvement_stock", {
    p_etablissement_id: etablissementId,
    ...parametres,
  });
  if (error) return { ok: false, erreur: error };
  // La fonction renvoie `setof produits` : un tableau, vide si aucune ligne n'est concernée.
  const ligne = Array.isArray(data) ? data[0] : data;
  return { ok: true, produit: ligne?.id ? ligne : null };
}

/** Remplace la ligne de stock correspondante, ou l'ajoute si elle est absente. */
export function fusionnerProduit(liste, produit) {
  if (!produit) return liste;
  return liste.some((p) => p.id === produit.id)
    ? liste.map((p) => (p.id === produit.id ? produit : p))
    : [...liste, produit];
}
