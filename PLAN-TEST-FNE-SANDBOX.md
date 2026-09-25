# Plan de validation sandbox KOMPTO — Option FNE ComptaCi

**Objectif** : valider l'intégration FNE sur l'environnement de test KOMPTO
(`https://qa.kompto.com`) avant toute mise en production.

**Règle absolue** : aucune bascule en production (`https://app.kompto.com`) avant
que les 12 scénarios soient passés **et** que les 9 points `TBD-KOMPTO` listés
en fin de document soient tous résolus. Une FNE confirmée est un document fiscal
légal **irréversible** : une erreur de contrat en production se corrige par un
avoir déclaré à la DGI, pas par une annulation.

Le garde-fou `configurationPretPourProduction()` dans `kompto.js` refuse
programmatiquement la bascule tant que ces conditions ne sont pas réunies.

---

## 0. Préparation (à faire une seule fois)

| # | Action | Détail |
|---|--------|--------|
| 0.1 | Obtenir les accès sandbox | Demander à KOMPTO une clé API **sandbox** + un jeu d'identifiants de test (`establishment`, `pointOfSale`, NCC) |
| 0.2 | Configurer le secret côté Supabase | `supabase secrets set KOMPTO_API_KEY=<clé_sandbox>` |
| 0.3 | Forcer l'environnement | `supabase secrets set KOMPTO_ENVIRONNEMENT=sandbox` |
| 0.4 | Déployer le proxy | `supabase functions deploy fne-kompto` — **sans** `--no-verify-jwt` : le JWT utilisateur est indispensable au contrôle d'appartenance |
| 0.5 | Exécuter la migration | `supabase-fne.sql` puis `supabase-fne-kompto.sql` |
| 0.6 | Créer un établissement de test | Choisir « connecter » (compte FNE existant), saisir les identifiants sandbox |
| 0.7 | Activer l'option en base | Appeler `activer_option_fne()` avec un `transaction_id` de test, ou prolonger `fne_expiration_date` manuellement |

**Sonde de vie** — `GET https://<ref>.supabase.co/functions/v1/fne-kompto` doit
renvoyer :

```json
{ "ok": true, "service": "fne-kompto", "environnement": "sandbox",
  "cle_api_configuree": true, "supabase_configure": true }
```

Si `cle_api_configuree` est `false`, le secret n'est pas posé : inutile
d'aller plus loin.

> ⚠️ Rappel : les factures produites en sandbox n'ont **aucune valeur
> fiscale**. L'écran doit l'indiquer explicitement au commerçant
> (`valeurFiscale: false` dans `diagnosticKompto()`).

---

## 1. Typologies de client

### Scénario 1 — B2B (entreprise ivoirienne)

- **Objectif** : valider qu'une vente à une entreprise ivoirienne est acceptée
  et que le NCC **client** est bien transmis.
- **Requête** : `POST /api/invoice/verify` avec `clientType: "B2B"`,
  `clientNCC: "<NCC client de test>"`, 1 article à 50 000 FCFA, `TVA` (18 %).
- **Attendu** : HTTP 200, un `komptoEntryId` renvoyé, TVA calculée par KOMPTO
  à 18 % (9 000 FCFA), TTC 118 000 FCFA pour 2 × 50 000.
- **Critère** : le `komptoEntryId` est présent et stocké immédiatement.

### Scénario 2 — B2C (particulier)

- **Objectif** : valider qu'aucun NCC client n'est exigé.
- **Requête** : `clientType: "B2C"`, nom du client, **sans** `clientNCC`.
- **Attendu** : HTTP 200. Si KOMPTO renvoie une erreur exigeant le NCC, noter le
  code exact → **résout TBD-KOMPTO #7**.

### Scénario 3 — B2G (administration publique)

- **Objectif** : valider la facturation à une entité publique.
- **Requête** : `clientType: "B2G"` + nom de l'administration.
- **Attendu** : HTTP 200. Vérifier si un identifiant public est exigé (à noter
  si c'est le cas).

### Scénario 4 — B2F (client étranger)

- **Objectif** : valider devise et taux de change.
- **Requête** : `clientType: "B2F"` + `currency: "EUR"` + `exchangeRate: 655.957`.
- **Attendu** : HTTP 200, montant converti en FCFA par KOMPTO.
- ⚠️ **Si erreur** : c'est le point le plus incertain du contrat — relever les
  noms de champs exacts attendus par KOMPTO → **résout TBD-KOMPTO #8**.

---

## 2. Structure des factures

### Scénario 5 — Remise

- **Objectif** : valider la transmission d'une remise.
- **Requête** : 1 article à 9 000 FCFA avec remise (`itemDiscount: 1000`).
- **Attendu** : HTTP 200, la remise est déduite par KOMPTO.
- ⚠️ Comparer le total obtenu avec et sans remise : si les deux sont identiques,
  le champ est ignoré → **résout le nom du champ de remise**.

### Scénario 6 — Multi-articles

- **Objectif** : valider une facture à plusieurs lignes.
- **Requête** : 3 articles (quantités et prix différents).
- **Attendu** : HTTP 200, total = somme des lignes, TVA calculée par ligne.

### Scénario 7 — TVA réduite

- **Objectif** : valider le taux réduit ivoirien (9 %).
- **Requête** : 1 article avec `itemTVAName: "TVAB"`.
- **Attendu** : HTTP 200, TVA à 9 % (et non 18 %).
- **Variante** : répéter avec `TVAC`, `TVAD`, `TVAE` (0 %) et vérifier que les
  trois sont acceptés et produisent bien 0 % de TVA.

---

## 3. Cycle de vie d'une facture

### Scénario 8 — Cycle complet `verify` → `confirm` → `getElectronicInvoice`

> **Le scénario central.** C'est lui qui valide le découpage en deux temps.

1. `POST /verify` → relever le `komptoEntryId` → le stocker **immédiatement**
   (appel `archiver_facture_fne`).
2. `POST /confirm` avec le `komptoEntryId` → **résout TBD-KOMPTO #2**.
3. `GET /getElectronicInvoice` → relever le numéro fiscal, le certificat, le
   QR code et l'URL du PDF.

- **Critères** :
  - `/confirm` accepte bien le seul `komptoEntryId` (sinon noter le corps
    exact attendu) ;
  - le numéro fiscal suit une série annuelle continue ;
  - le certificat contient bien un visuel FNE et un QR code ;
  - la facture passe au statut `confirmee` avec `environnement: 'sandbox'`.
- ⚠️ **Irréversibilité** : vérifier qu'une seconde tentative de `/confirm` sur le
  même `komptoEntryId` est rejetée proprement (et non dupliquée) → **résout
  TBD-KOMPTO #7** (cas « déjà confirmée »).

### Scénario 9 — Récupération (`getVerify` + `getElectronicInvoice`)

- **Objectif** : valider la relecture, y compris après fermeture de l'écran.
- **Étapes** :
  1. `/verify` → relever l'identifiant, **ne pas** confirmer ;
  2. `GET /getVerify` → la facture vérifiée est relue → **résout TBD-KOMPTO #4** ;
  3. `/confirm` puis `GET /getElectronicInvoice` → la FNE est relue.
- **Attendu** : les deux GET renvoient les mêmes données qu'aux étapes 1 et 3 du
  scénario 8.
- **Cas limite** : `getVerify` sur une facture **déjà confirmée** — noter si
  KOMPTO renvoie 404, une erreur, ou la facture confirmée.

### Scénario 10 — Avoir (`createCreditNote`)

- **Objectif** : valider la seule correction possible d'une facture confirmée.
- **Étapes** :
  1. Réaliser le scénario 8 jusqu'à la confirmation ;
  2. `POST /createCreditNote` en référençant la facture d'origine
     (`originalKomptoEntryId`) → **résout TBD-KOMPTO #5** ;
  3. Archiver la ligne avec `type_document: 'avoir'` et `avoir_de` = id d'origine.
- **Attendu** : HTTP 200, un nouvel identifiant distinct, un document d'avoir
  récupérable.
- **Critère** : l'avoir apparaît dans l'archive, lié à sa facture d'origine.

### Scénario 11 — Suppression (`delete`)

- **Objectif** : valider l'annulation **avant** confirmation.
- **Étapes** :
  1. `/verify` → relever l'identifiant ;
  2. `DELETE /api/invoice/delete` avec cet identifiant → **résout TBD-KOMPTO #4** ;
  3. Vérifier que la facture n'existe plus côté KOMPTO.
- **Attendu** : HTTP 200, statut local `annulee`.
- **Critère négatif** : `delete` sur une facture **déjà confirmée** doit être
  **refusé**. Si KOMPTO l'acceptait, il faudrait bloquer cet appel côté
  ComptaCi — c'est le point de contrôle le plus important de ce scénario.

---

## 4. Cas d'erreur

### Scénario 12 — Erreurs rejetées par KOMPTO (2 cas)

**Cas 12.1 — NCC client invalide**

- **Requête** : `clientType: "B2B"` avec un NCC au bon format mais inexistant.
- **Attendu** : rejet avec un message explicite.
- **À relever** : code d'erreur **exact** et message → **résout TBD-KOMPTO #7**.
- **Critère ComptaCi** : l'erreur est classée `ncc_invalide` par
  `classifierErreur()`, affichée en clair, et la facture reste en archive sans
  être confirmée.

**Cas 12.2 — Code TVA non reconnu**

- **Requête** : `itemTVAName: "TVAZ"` (code inexistant).
- **Attendu** : rejet.
- **À relever** : code d'erreur exact → **résout TBD-KOMPTO #7**.
- **Critère ComptaCi** : le contrôle local
  (`validerFacturePourKompto`, erreur `ligne_N:tva_non_reconnue:TVAZ`) doit
  attraper ce cas **avant** l'appel réseau. Ce scénario valide donc aussi
  qu'aucun appel n'est gaspillé.

**Cas bonus recommandé** : `establishment` / `pointOfSale` **inexistants** — permet
de vérifier que le proxy Edge injecte bien les bons identifiants depuis la base
→ **résout TBD-KOMPTO #1**.

---

## 5. Validation de la sécurité

À exécuter en parallèle des 12 scénarios. Ces contrôles protègent la clé
d'intégrateur partagée : ils sont aussi importants que les tests fonctionnels.

| # | Contrôle | Attendu |
|---|----------|---------|
| S1 | `grep -r "KOMPTO_API_KEY" dist/` après `npm run build` | **Aucun résultat** |
| S2 | Une requête sans JWT vers `fne-kompto` | HTTP 401 `authentification_requise` |
| S3 | Un JWT valide d'un **autre** établissement | HTTP 403 `acces_refuse` |
| S4 | `establishment` / `pointOfSale` envoyés par le client, différents de ceux en base | Valeurs du client **ignorées**, celles de la base utilisées |
| S5 | `/confirm` avec le `komptoEntryId` d'un autre établissement | HTTP 403 `facture_d_un_autre_etablissement` |
| S6 | Établissement avec `fne_statut: 'en_cours'` ou option expirée | HTTP 403 `option_fne_indisponible` |
| S7 | Établissement en `plan: 'starter'` avec option payée | **HTTP 200** — la FNE est ouverte à tous les forfaits |
| S8 | Table `appels_fne_kompto` | Chaque appel journalisé, **sans payload** |

---

## 6. Points TBD-KOMPTO à résoudre

Les 9 inconnues du contrat, isolées dans `kompto.js`. **Aucune mise en
production avant résolution des 9.** Le scénario qui résout chacune est indiqué.

| # | Inconnue | Résolue par | Statut |
|---|----------|-------------|--------|
| 1 | Emplacement et noms exacts de `establishment` / `pointOfSale` | Sc. 1 + cas bonus | ☐ |
| 2 | Corps exact de `/confirm` | Sc. 8 | ☐ |
| 3 | Emplacement du `komptoEntryId` dans la réponse `/verify` | Sc. 1 | ☐ |
| 4 | Noms des paramètres GET de `getVerify` / `getElectronicInvoice` / `delete` | Sc. 9, 11 | ☐ |
| 5 | Corps exact de `/createCreditNote` | Sc. 10 | ☐ |
| 6 | Valeurs littérales de `paymentMethod` autres que `"transfer"` | Sc. 1–7 | ☐ |
| 7 | Index des erreurs (NCC invalide, TVA inconnue, déjà confirmée) | Sc. 2, 8, 12 | ☐ |
| 8 | Champs B2F (devise, taux de change) | Sc. 4 | ☐ |
| 9 | Endpoints du parcours d'enrôlement « Créer une FNE » | **Hors API publique** — voir ci-dessous | ☐ |

### ⚠️ Point 9 — le point bloquant à traiter en priorité

Le parcours « **Créer une FNE** » (création du compte FNE, de l'établissement et
du point de vente **par KOMPTO**) ne figure **pas** parmi les 7 endpoints de
facturation publiés sur `kompto.com/KomptoApi`.

Deux issues possibles :

- **les endpoints existent** mais ne sont documentés que dans le *Guide API
  v.5.3* → les implémenter et les ajouter à `KOMPTO_ENDPOINTS` ;
- **ils n'existent pas** → l'option « Créer une FNE » ne peut pas être un appel
  API. Il faut alors la transformer en parcours guidé : ComptaCi collecte les
  pièces (RCCM, NCC, IdentitéUnique…) et les transmet à KOMPTO **hors API**
  (e-mail ou espace partenaire), l'activation étant finalisée manuellement.

**À clarifier avec KOMPTO avant d'implémenter l'écran « Créer une FNE ».**

---

## 7. Bascule en production

Checklist finale, à cocher intégralement :

- ☐ Les 12 scénarios sandbox sont passés
- ☐ Les 8 contrôles de sécurité (S1 à S8) sont passés
- ☐ Les 9 points TBD-KOMPTO sont résolus et les marqueurs retirés du code
- ☐ `IDENTIFIANTS_EMPLACEMENT_CONFIRME` passé à `true` dans `kompto.js`
- ☐ NCC de production renseigné pour chaque établissement
- ☐ Un 4ᵉ lien SasPay dédié à l'option FNE (100 000 FCFA) existe
- ☐ `supabase secrets set KOMPTO_ENVIRONNEMENT=production`
- ☐ `supabase secrets set KOMPTO_API_KEY=<clé_production>`
- ☐ `supabase functions deploy fne-kompto`
- ☐ Une première FNE réelle émise, relue et archivée, contrôlée par un humain

---

## 8. Références

- Contrat public officiel : <https://kompto.com/KomptoApi>
- Base sandbox : `https://qa.kompto.com` · Base production : `https://app.kompto.com`
- Auth : `Authorization: Bearer {clé_api}` (**côté serveur uniquement**)
- Code : `kompto.js` (adaptateur) · `fneOption.js` (règles métier) ·
  `supabase/functions/fne-kompto/index.ts` (proxy détenteur de la clé)
- Tests unitaires : `npm test` (scénarios simulés sur KOMPTO mocké)
- ⚠️ Ne pas deviner les champs : une équipe tierce a publié un scaffold KOMPTO
  en les supposant, puis l'a retiré en écrivant que « les noms de champs
  KOMPTO, le découpage verify/confirm et le corps de confirm deviné sont le
  mauvais contrat » — <https://github.com/lomiafrica/lomi./pull/108>
