# KOMPTO Postman — Sandbox

Collection officielle **KOMPTO API — Sandbox** (FNE — Facture Normalisée Électronique, Côte d'Ivoire) basée sur le guide **KOMPTO API GUIDE EN v5.2**.

Fichier principal :

- [`KOMPTO-Sandbox.postman_collection.json`](./KOMPTO-Sandbox.postman_collection.json)

> Collection complète avec variables, auth Bearer, pré-requêtes, scripts de test
> et clonage automatique des variables (`komptoEntryId`, `komptoItemId`,
> `confirmedEntryId`, `numberFNE`, `linkFNE`). L’original fourni par KOMPTO
> contient 8 dossiers (auth, verify, confirm, create, retrieval, credit notes,
> delete, payload examples). Ce dépôt en conserve une copie normalisée prête
> à importer dans Postman.

## Import

1. Postman → **Import** → glisser `KOMPTO-Sandbox.postman_collection.json`
2. Onglet **Variables** de la collection :
   - `apiKey` → coller la clé sandbox KOMPTO (UUID, vide par défaut)
   - `baseUrl` → `https://qa.kompto.com` (déjà renseigné)
   - `establishment` / `pointOfSale` → `PROGICI SARL` / `SIEGE` (sandbox partagé)
3. Lancer les dossiers dans l’ordre (01 → 08).

## Variables d’environnement ComptaCi

Même noms côté app (voir `.env.example` et `kompto.js`) :

```
VITE_KOMPTO_API_URL=https://qa.kompto.com
VITE_KOMPTO_API_KEY=...
VITE_KOMPTO_ESTABLISHMENT=PROGICI SARL
VITE_KOMPTO_POINT_OF_SALE=SIEGE
```

Voir `kompto.js` pour le client complet (parsing montants `,` / `%`, gestion des 3
formes d’erreur, enveloppe `value` de `getVerify`, etc.).
