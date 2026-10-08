/**
 * Droits selon le rôle de l'établissement sélectionné.
 *
 * - propriétaire : gère le stock (ajout, modification, suppression) et
 *   supprime les mouvements et les fournisseurs ;
 * - gérant (invité par code d'invitation) : saisit les ventes et dépenses (qui
 *   ajustent les quantités des produits existants), corrige le montant et la
 *   note d'un mouvement, lit le stock sans le modifier.
 *
 * La base (RLS, voir supabase-stock-proprietaire.sql) applique les mêmes
 * règles : ces fonctions ne font qu'adapter l'interface.
 */

/** Vrai uniquement pour le propriétaire de l'établissement sélectionné. */
export function estProprietaire(role) {
  return role === "proprietaire";
}
