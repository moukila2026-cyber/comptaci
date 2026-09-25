# KOMPTO — Intégration FNE (Facture Normalisée Électronique)

Intégration fidèle au **KOMPTO API GUIDE EN v5.2** (sandbox `https://qa.kompto.com`, prod sur host dédié KOMPTO).

## Où trouver quoi

| Fichier | Rôle |
|---|---|
| `kompto.js` | Client HTTP complet (verify / confirm / create / getters / creditNote / delete), parsing montants `,` ↔ `.` et `%`, gestion des 3 formes d'erreur, `dateTimeFNE` `YYYY-MM-DD HH:mm`, enveloppe `value` de `getVerify`. |
| `fne.js` | Façade ComptaCi (brouillon local ↔ certifié KOMPTO). Délègue à `kompto.js` quand `kompto_api_key` est présent, sinon reste en `FNE-BROUILLON-…`. |
| `FacturationFNE.jsx` | UI Pro/Entreprise : 4 onglets (Enrôlement KOMPTO, Facturer, Ventes rapides, Archive). Gère Path A (verify→confirm) recommandé, Path B (create), avoirs et suppressions. Affiche `komptoEntryId`/`numberFNE`/`linkFNE` et les totaux décodés. |
| `postman/KOMPTO-Sandbox.postman_collection.json` | Collection Postman complète — 8 dossiers, variables chaînées, scripts de test. Importer tel quel. |
| `postman/README.md` | Guide d'import Postman. |
| `supabase-kompto.sql` | Migration idempotente : colonnes `kompto_*` sur `etablissements`, enrichissement `factures_fne` (number_fne, link_fne, kompto_entry_id…). |
| `.env.example` | Variables `VITE_KOMPTO_API_URL`, `VITE_KOMPTO_VERIF_URL`, `VITE_KOMPTO_API_KEY` (dev). |
| `tests/kompto.test.js` | Tests de parsing et de construction de payloads. |

## Variables KOMPTO

Côté collection Postman (Variables tab) et côté app (Supabase `etablissements`) :

- `baseUrl` / `kompto_base_url` — `https://qa.kompto.com` en sandbox. En prod : host fourni par KOMPTO.
- `apiKey` / `kompto_api_key` — UUID KOMPTO. Vide par défaut (401 si oubliée).
- `establishment` / `kompto_etablissement` — `PROGICI SARL` en sandbox partagé.
- `pointOfSale` / `kompto_point_de_vente` — `SIEGE` en sandbox.

> `establishment` / `pointOfSale` sont matchés **caractère pour caractère** par la DGI. `PDV1` ≠ `pdv1` ≠ `PDV 1`. KOMPTO ne peut pas pré-valider — une erreur revient en `400 La DGI a rejeté la facture`.

`clientName`, `clientNCC`, `clientTelephone`, `clientEmail` sont les données client de test (fictif du guide).

## Deux chemins d'intégration

**Path A — verify → confirm (recommandé pendant l'intégration)**

1. `POST /api/invoice/verify` — valide, calcule (HT, remises, TVA, TTC, taxes additionnelles, timbre si cash), stocke en **pending**, rend `komptoEntryId` + `komptoItemId`. Rien ne part à la DGI.
2. L'app affiche les montants à l'utilisateur.
3. `POST /api/invoice/confirm` — soumet le brouillon à la DGI. Retourne `numberFNE` (19 chars, préfixé `A` pour les avoirs), `linkFNE`, `stickerFNEbalance`. Consomme 1 crédit.

Si `/verify` révèle un problème → `DELETE /api/invoice/delete?komptoEntryId=`.

**Path B — create direct**

`POST /api/invoice/create` = verify+confirm en un appel. À n'utiliser que quand les montants sont sûrs. Si la DGI rejette, le brouillon laissé côté KOMPTO est difficile à retrouver (pas d'`komptoEntryId` dans l'erreur).

La confirmation est **irréversible**. Corriger une certifiée = `POST /api/invoice/createCreditNote` avec `{komptoEntryId, items:[{komptoItemId, itemQuantity}]}` (quantité uniquement, prix hérité pro rata).

## Pièges couverts par ce dépôt

- **Montants :** envoyés en `number` (`50000`), reçus en `string` (`"50000"`). Décimales : dot à l'envoi (`655.957`), comma au retour (`"655,9570"`). Helper `parseMontantKompto`.
- **% :** reçus avec `%` (`"18%"`, `"2,50%"`), envoyés en `number` (`10`). Helper `parsePourcentKompto`.
- **Taxes optionnelles :** `null` / omitted si inutilisées, **jamais `0`**. Chaque paire (`*Name` + `*Percent`) est tout ou rien.
- **En-têtes :** `Authorization: Bearer {{apiKey}}` — jamais dans le body.
- **Erreurs :** 
  - `401` `application/problem+json` (`Clé API invalide`),
  - `400` avec `errors: { CustomerNCC: [...] }` (champs internes KOMPTO),
  - `400` / `200` avec `{ isSuccessful:false, message: "La DGI a rejeté..." }`,
  - `404` bare string `"La commande n'existe pas."`.
  → toujours vérifier `isSuccessful` même en `200`. Messages en français, affichés tels quels.
- **`dateTimeFNE` :** `YYYY-MM-DD HH:mm` (heure CI, sans secondes / fuseau) — parser `parseDateTimeFNE`.
- **`getVerify` :** enveloppe `{ value: {…invoice…} }`. Les autres endpoints sont plats. `kompto.js:unwrapKompto` gère les deux.
- **`getVerify` sur certifiée :** renvoie `200` avec les totaux pré-certification (sans timbre). Après certification, seule `getElectronicInvoice` fait foi.
- **Avoirs :** cumulables, `quantité retournée ≤ quantité initiale − déjà retournée`. Aucun endpoint ne liste les avoirs — l'ERP doit tracer le solde.

## Environnement

```bash
VITE_KOMPTO_API_URL=https://qa.kompto.com
VITE_KOMPTO_VERIF_URL=https://fne.dgi.gouv.ci/verification
# en dev seulement : VITE_KOMPTO_API_KEY=...
```

En production : changer `baseUrl` vers le host prod KOMPTO, clé prod, et `establishment`/`pointOfSale` de l'entreprise (pas `PROGICI SARL`).

Les factures sandbox sont au nom de **PROGICI SARL** et sans valeur fiscale.

## Migrations Supabase

```sql
-- dans Supabase → SQL Editor
-- 1) setup final si ce n'est pas fait
-- supabase-SETUP-FINAL.sql

-- 2) FNE historique
-- supabase-fne.sql

-- 3) KOMPTO (ce dépôt)
-- supabase-kompto.sql     -- ajoute kompto_api_key, base_url, établissement...
```

La table `factures_fne` conserve légalement 10 ans (`conserve_jusqua`).

## Tests & build

```bash
npm test        # 45 tests (secteurs, saisie, kompto parsing, essai)
npm run build   # vite build → dist/
```

## Référence rapide cURL (sandbox)

```bash
# 1) Vérifier la clé (attendu 404 = OK)
curl -H "Authorization: Bearer $KOMPTO_API_KEY" \
  "https://qa.kompto.com/api/invoice/getVerify?komptoEntryId=0"

# 2) Vérifier (draft)
curl -X POST "https://qa.kompto.com/api/invoice/verify" \
  -H "Authorization: Bearer $KOMPTO_API_KEY" -H "Content-Type: application/json" \
  -d '{"clientType":"B2B","clientName":"KOUAME ET FRERES SARL","clientNCC":"8200001A","clientTelephone":"2721212121","clientEmail":"contact@kouame-freres.ci","items":[{"itemName":"Consulting service","itemQuantity":2,"itemUnitPrice":50000,"itemDiscountPercent":10,"itemTVAName":"TVA"}]}'

# 3) Confirmer (utiliser komptoEntryId du 2)
curl -X POST "https://qa.kompto.com/api/invoice/confirm" \
  -H "Authorization: Bearer $KOMPTO_API_KEY" -H "Content-Type: application/json" \
  -d '{"komptoEntryId":123,"establishment":"PROGICI SARL","pointOfSale":"SIEGE","paymentMethod":"transfer","isRNE":false}'

# 4) Lire certifiée
curl -H "Authorization: Bearer $KOMPTO_API_KEY" \
  "https://qa.kompto.com/api/invoice/getElectronicInvoice?komptoEntryId=123"
```
