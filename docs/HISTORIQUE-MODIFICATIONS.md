# Historique des modifications — espace propriétaire

## Activation

1. Sur la base existante (déjà initialisée avec `supabase-SETUP-FINAL.sql`, ou les tables équivalentes du script maître), exécuter **`supabase-historique-modifications.sql`** dans **Supabase → SQL Editor**.
2. Déployer l'application mise à jour.
3. Se connecter comme propriétaire et ouvrir **Historique des modifications**, après **Historique** dans la navigation. Le menu existe sur mobile et ordinateur, quel que soit le forfait.

Le script est transactionnel et peut être réexécuté. Il n'altère aucun mouvement, stock ou montant existant. Il requiert les tables `etablissements`, `membres`, `transactions`, `produits`, `fournisseurs`, `sessions_caisse` et Supabase Auth.

**Aucune action antérieure à l'installation ne peut être reconstituée.** Si la migration manque, seule cette nouvelle rubrique affiche un message d'activation ; le reste de l'application fonctionne normalement. Ne pas confondre cette rubrique avec l'historique des mouvements ni avec les sessions de caisse clôturées, qui restent inchangés.

## Périmètre

| Domaine | Données suivies |
| --- | --- |
| Mouvements | Type, montant, catégorie, note, date, quantité, désignation, poste |
| Stock | Désignation, quantité disponible, prix unitaire, seuil d'alerte |
| Fournisseurs | Nom, téléphone, note |
| Caisse | Ouverture, fermeture, fonds, écart, statut |
| Établissement | Nom, téléphone, secteur, forfait, abonnement actif |

Les ajouts, modifications et suppressions des quatre premiers domaines sont enregistrés automatiquement par des triggers PostgreSQL. Les ajouts et modifications d'établissement sont également suivis. Une vente qui ajuste le stock peut donc produire deux événements distincts : mouvement et stock. Un ajustement de stock fait par un gérant (vente ou dépense) passe par la fonction `appliquer_mouvement_stock` et reste journalisé avec ce gérant comme auteur.

Les valeurs avant/après sont conservées ; pour une modification, l'interface n'affiche que les champs réellement changés. Les mises à jour sans changement métier (par exemple `maj_le` seul) sont ignorées. Les factures FNE, les paiements détaillés, les invitations/membres et les changements du compte d'authentification ne font pas partie de ce journal.

Chaque événement porte un horodatage serveur, la référence de l'objet, l'identifiant de l'auteur, son email/téléphone et son rôle au moment de l'action. Les écritures sans utilisateur authentifié sont indiquées « Système ». Les dates sont affichées dans le fuseau du navigateur.

L'interface est disponible en français, anglais et arabe : filtres par domaine et action, pagination de 25 événements, actualisation et reprise après erreur. Le journal se recharge à chaque ouverture ; utiliser **Actualiser** pour voir les dernières actions d'un autre appareil. Il n'y a pas d'actualisation temps réel.

## Sécurité et conservation

- Le menu et le composant sont réservés au rôle `proprietaire` de l'établissement sélectionné.
- **RLS** vérifie aussi `etablissements.proprietaire_id = auth.uid()` : masquer le menu n'est pas l'unique protection. Un gérant interrogeant directement l'API ne reçoit aucune ligne.
- Un propriétaire de A qui est gérant de B ne peut pas consulter le journal de B.
- Aucun droit INSERT, UPDATE, DELETE ou TRUNCATE sur le journal pour les rôles navigateur `anon` et `authenticated`, y compris le propriétaire. Seuls les triggers privilégiés l'alimentent ; les administrateurs de la base gardent leurs pouvoirs habituels.
- Les écritures métier et leur journal sont atomiques : une opération annulée ou échouée ne crée pas de trace persistante. Une erreur d'écriture du journal fait échouer l'opération métier plutôt que de perdre la trace.
- Une liste blanche exclut les clés API, codes d'invitation et autres secrets des paramètres de l'établissement. Les notes métier restent enregistrées : ne pas y saisir de secrets.
- La suppression d'un objet métier ou du compte de son auteur ne supprime pas les événements correspondants. Les références et l'identité de l'auteur y sont conservées.
- La suppression de l'établissement (y compris lors d'une suppression de compte propriétaire) efface son journal en cascade. Il n'y a pas de purge automatique ni de limite de 30 jours.
- Déplacer directement un mouvement, produit, fournisseur ou une session de caisse vers un autre établissement est interdit par le trigger, pour éviter de mélanger leurs historiques. L'application ne propose pas ce déplacement.

## Vérifications

```sh
npm test
npm run build
```

Les tests SQL utilisent PostgreSQL embarqué via PGlite, sans connexion à une base réelle : idempotence, triggers, différences, rollback, absence de secrets, RLS propriétaire/gérant, isolement entre établissements, refus de falsification et compatibilité des suppressions en cascade.

Les tests React couvrent le menu mobile/ordinateur, l'absence de requête pour un gérant, les valeurs avant/après, filtres, pagination, états vide/chargement/erreur, reprise et réponses tardives lors d'un changement d'établissement.

Après déploiement, vérifier aussi sur Supabase :
1. Un gérant corrige le montant ou la note d'un mouvement et enregistre une vente qui baisse la quantité d'un produit existant. Il ne voit aucun bouton d'ajout, de modification ou de suppression du stock, ni de suppression de mouvement ou de fournisseur. Dans le journal, l'ajustement de stock apparaît avec ce gérant comme auteur.
2. Le propriétaire actualise le journal : les événements, l'auteur et les valeurs sont visibles.
3. Le gérant ne voit pas le menu ; une lecture directe de `historique_modifications` avec son JWT retourne une liste vide.
4. Un propriétaire d'un autre établissement ne voit pas ces événements.
