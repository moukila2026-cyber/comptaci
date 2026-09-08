# ComptaCi — Corrections & améliorations (à lire avant déploiement)

## Correctif dépenses par activité — 20 suggestions, séparées du stock

- **200 suggestions** : exactement 20 frais de fonctionnement pour chacun des
  10 types, définis dans `depensesActivites.js`.
- Les 20 boutons et l'autocomplétion sont disponibles automatiquement dans
  **Saisie du jour → Dépense**, suivant le type de l'établissement actif.
- Un clic remplit le libellé, la catégorie et la quantité 1. Le montant reste
  vide : saisir le paiement réel puis enregistrer, sans écriture fictive.
- Les produits à vendre et consommables stockables utilisent un catalogue
  distinct (`produitsDuSecteur`). Le stock n'importe plus de loyers/salaires.
- Les achats réels de marchandises restent saisissables librement dans leur
  catégorie ; supprimer des suggestions ne supprime pas une charge comptable.
- Les anciens identifiants et libellés sont conservés dans `anciensPostes.js`
  pour l'historique. Aucun montant, stock ou enregistrement existant n'est modifié.
  Les anciennes dépenses hors nouveau catalogue restent dans « Autre / non classé »
  pour la répartition par poste, et gardent leur catégorie historique.
- **Déploiement de l'application uniquement** : aucune migration SQL supplémentaire
  n'est nécessaire pour ce correctif de catalogue.
- Vérifications : `npm test` (catalogues et interactions du composant Saisie),
  `npm run build`.

## Correctif essai fondateurs — 14 jours

Après le déploiement de l'application, exécuter **`supabase-essai-14jours.sql`**
dans **Supabase → SQL Editor**, sur une base déjà initialisée avec le setup final.
Ce correctif dédié synchronise les nouvelles inscriptions et les comptes existants
avec l'essai de 14 jours. Il conserve la date de création (pas de remise à zéro),
les abonnements payés et les durées supérieures à 14 jours. Il peut être relancé.
La limite de l'offre reste fixée à **100 établissements**, avec verrouillage contre
les inscriptions simultanées. Ne pas réexécuter un ancien script d'essai ensuite.

L'application prend également en charge les anciennes valeurs de 3/7 jours dès
son déploiement : bandeau commun à tous les onglets, accès, compte à rebours,
choix des forfaits et score crédit utilisent une durée commune d'au moins 14 jours.
Exemple : **6 j 8 h** restantes auparavant deviennent **13 j 8 h** au même instant.

Vérifications : `node --test tests/essai.test.js` et `npm run build`.

## 1) ÉTAPE OBLIGATOIRE — corriger la base de données

Tous les bugs signalés (ajout de produit en stock impossible, erreur à la
saisie d'un mouvement, bouton d'invitation de gérant invisible, fournisseurs
et caisse "inexistants", **boutons sans réaction après connexion**) viennent
du fait que les tables/colonnes/politiques nécessaires n'existent pas encore
dans ta base Supabase.

**Va dans Supabase → SQL Editor → colle et exécute :**

**`supabase-SETUP-FINAL.sql`** (une seule fois) — c'est le script unique et
définitif qui remplace tous les anciens fichiers (`supabase-MASTER-COMPLET.sql`,
`supabase-fix-rls-actions.sql`, etc.). Il crée, dans l'ordre, tout ce qui
manque :

1. toutes les tables, colonnes et politiques de base ;
2. les autorisations d'écriture : les **gérants** peuvent désormais saisir
   ventes/dépenses, gérer le stock, les fournisseurs et la caisse (avant,
   les politiques RLS bloquaient leurs écritures → les boutons semblaient
   morts) ;
3. **la fonction RPC `creer_etablissement`** (correctif définitif) : la
   création d'un établissement insère désormais l'établissement **et** la
   ligne « membres » du propriétaire dans une seule transaction, en
   contournant la RLS. C'est ce qui répare définitivement l'inscription et
   le bouton « Nouvel établissement » sans réaction.

Le script est 100% idempotent : on peut le relancer sans risque, il ne crée
que ce qui manque et ne touche pas aux données existantes.

Après exécution :
- tout nouvel établissement démarre avec le plan Starter à **0 FCFA pendant
  14 jours**, avec 1 gérant invitable ;
- au bout de 14 jours, l'accès est bloqué automatiquement et les 3 plans
  (Starter / Pro / Entreprise) sont présentés avec leurs détails ;
- l'ajout de produits en stock, la saisie de mouvements, les fournisseurs,
  la caisse ET toutes les actions des gérants fonctionnent.

## 1bis) ÉTAPE OBLIGATOIRE — désactiver la confirmation d'email

ComptaCi utilise des adresses email internes (`<téléphone>@comptaci.app`)
qui n'ont **pas de boîte de réception**. Si Supabase exige une confirmation
par email, l'inscription renvoie un compte sans session et l'utilisateur
reste bloqué sur l'écran de connexion (bouton sans effet).

**Supabase → Authentication → Providers → Email → décocher « Confirm email »
(« Confirm signup ») puis Enregistrer.**

Si la case reste cochée, l'application affiche désormais un message clair
expliquant la manipulation, au lieu de rester sans réaction.

## 2) Corrections apportées côté application

- Bouton de déconnexion ajouté sur mobile (il n'existait que sur desktop).
- Chargement des données rendu résilient : si une table venait à manquer,
  le reste de l'app continue de fonctionner au lieu de tout bloquer, et un
  message précis s'affiche pour te dire quoi vérifier.
- Messages d'erreur plus explicites sur l'ajout de produit / fournisseur.
- Essai gratuit passé à **14 jours à 0 FCFA** partout côté interface
  (au lieu de 3 puis 7 jours).
- Page de blocage après essai : le 3ᵉ plan "Entreprise" a été ajouté avec
  son descriptif, à côté de Starter et Pro.

## 3) Habillage visuel (images corrigées)

**Correctif appliqué :** les 5 images référencées par le code
(`/images/photo-boutique.jpg`, `photo-marche.jpg`, `photo-saisie.jpg`,
`promo-dashboard.png`, `promo-controle.png`) étaient absentes du dépôt — le
dossier `public/images/` n'existait pas. Elles renvoyaient une page HTML au
lieu d'une image (404 déguisé) : bannières cassées sur la landing page,
en-têtes de pages et fonds d'écrans de connexion vides dans l'app.
Les fichiers sont désormais présents dans **`public/images/`** et sont
automatiquement copiés dans le build (déployés avec le site).

- **Landing page (`index.html`)** :
  - nouvelle bannière plein écran en haut de page avec la photo de la
    commerçante, un texte minimal ("Votre activité. Votre contrôle.",
    "Ventes • Dépenses • Résultats • Suivi à distance") et le bouton
    "PRENEZ LE CONTRÔLE" ;
  - bannière photo pleine largeur juste au-dessus de "Comment ça marche" ;
  - bannière (visuel promotionnel fourni) juste au-dessus de "Tarifs" ;
  - bannière (second visuel promotionnel) juste au-dessus de "Prêt à voir
    clair sur votre rentabilité ?" ;
  - textes traduits en français / anglais / arabe.
- **Application (`app.html`)** : chaque page (Tableau de bord, Saisie,
  Caisse, Stock, Historique, Fournisseurs, Abonnement) affiche désormais
  une bannière photo professionnelle en haut, différente selon la page.
- **Écrans de connexion et de blocage d'abonnement** : fond photo
  professionnel avec dégradé sombre pour garder le formulaire lisible.

Les images sont dans `public/images/` et sont donc automatiquement
déployées avec le site (rien à faire de plus).


## 4) Paiement Wave + validation (nouveau)

### Affichage du QR
Le QR était une capture d'écran verticale (720×1612) affichée en `object-fit: cover`
dans un carré 200×200 → le code était **rogné et illisible**.  
Correctif : image carrée croppée dans `public/images/wave-qr.png`, affichage en
`object-fit: contain`, avec repli data-URI (`WaveQR.js`).

### Parcours client
1. Choisir le forfait (Starter / Pro / Entreprise)
2. Scanner le QR Wave **ou** envoyer le montant au **05 46 69 74 78**
3. Cliquer **« J'ai payé »** (téléphone + référence Wave optionnelle)
4. Une ligne est créée dans `demandes_paiement` (statut `en_attente`)
5. Bouton WhatsApp prérempli pour prévenir l'équipe

### Validation admin (vous)
Après avoir relancé **`supabase-SETUP-FINAL.sql`** :

```sql
-- File d'attente
select * from v_paiements_en_attente;

-- Valider une demande (active abonnement_actif + pose le plan)
select public.valider_paiement('<uuid_de_la_demande>');

-- Ou refuser
select public.refuser_paiement('<uuid_de_la_demande>', 'motif');
```

L'écran de blocage interroge l'établissement toutes les 15 s : dès que
`abonnement_actif = true`, l'utilisateur entre automatiquement dans l'app.

---

## Tarifs & offre Fondateurs (règle définitive)

| Formule | Prix | Pour qui |
|---|---|---|
| **Essai gratuit** | **0 FCFA pendant 14 jours** | Tout nouvel établissement |
| Starter | **7 000 FCFA/mois** | Tout le monde |
| Pro | **10 000 FCFA/mois** | Tout le monde |
| Entreprise | **20 000 FCFA/mois** | Tout le monde |

**L'essai passe de 7 à 14 jours et coûte 0 FCFA** (`JOURS_ESSAI = 14`,
`etablissements.essai_jours = 14`). Le message affiché partout est désormais :

> 0 FCFA pendant 14 jours d'essai — ensuite, choix libre entre le plan Starter, Pro ou Entreprise

**Offre Fondateurs = les 100 premiers établissements.**

```
J0 ──────── 14 jours d'essai gratuit (0 FCFA) ──────── J14 ───────────────▶
  accès équivalent au plan STARTER                      choix libre :
  Pro + Entreprise affichés mais cadenassés            Starter · Pro · Entreprise
```

- **Pendant les 14 jours** : l'établissement paie **0 FCFA**. Un fondateur
  (`est_fondateur = true`) dispose de l'accès équivalent au plan Starter
  (`tarif_verrouille = 7000` après l'essai). Les forfaits Pro et Entreprise
  restent **affichés** (prix, note, 6 caractéristiques) mais **cadenassés** :
  `aria-disabled="true"`, un clic affiche l'explication au lieu de changer de plan, et un
  compte à rebours indique « Pro et Entreprise se débloquent dans X j Y h ».
- **À la fin des 14 jours** : choix libre entre Starter (7 000), **Pro (10 000)**
  ou **Entreprise (20 000)**, au tarif normal. Les cartes Pro / Entreprise portent alors le
  badge « Disponible — upgrade fondateur ».
- Un minuteur interne (30 s) débloque les boutons **sans rechargement de page**.
- Le 101é établissement créé n'est pas fondateur et voit les trois forfaits dès le départ.

### Fenêtre de l'offre

Front (`PaiementSasPay.jsx` — `fondateurVerrouille()`) et SQL partagent la même règle :

```sql
now() < date_creation + make_interval(days => coalesce(essai_jours, 14))
```

Migration à exécuter une fois : **`supabase-types-etablissements.sql`**
(passe les essais en cours de 7 à 14 jours sans jamais les raccourcir).

### Où la règle est appliquée

1. **`PaiementSasPay.jsx`** — constantes `PRIX_PLANS`, `PRIX_FONDATEUR = 7000`,
   `LIMITE_FONDATEURS = 100`, `JOURS_FONDATEUR = 14` (= `JOURS_ESSAI`), `AVANTAGES_PLANS` (6 clés
   `abo_feat_*` par forfait) ; fonctions exportées `estFondateur()`, `finEssai()`,
   `fondateurVerrouille()`, `tarifFondateurActif()`, `resteAvantDeblocage()`,
   `plansDisponibles()`, `planEffectifFondateur()`, `montantDuPlan()`.
2. **`App.jsx`** — `export function Abonnement()` et `export const LIGNES_COMPARATIF`
   (9 caractéristiques sans doublon) alimentent la carte « Comparer les forfaits »
   (9 lignes × 3 colonnes), avec les styles `comparatif*` et la media query
   `.comparatif-row` dans `GLOBAL_CSS`.
3. **`supabase-SETUP-FINAL.sql` / `supabase-MASTER-COMPLET.sql` / `supabase-fondateurs.sql`** :
   - `appliquer_offre_fondateur()` force `plan = 'starter'` pour les 100 premiers
     établissements (verrou `pg_advisory_xact_lock` contre les inscriptions simultanées) ;
   - `empecher_sortie_plan_fondateur()` (trigger `BEFORE UPDATE`) **n'agit que pendant
     l'offre** : après les 14 jours, un fondateur peut passer en Pro ou Entreprise ;
   - `forcer_plan_fondateur_demande()` (trigger sur `demandes_paiement`, SETUP-FINAL)
     ramène la demande à `starter` / 7 000 FCFA **pendant l'offre seulement** ; après,
     le montant réel (10 000 / 20 000) est conservé ;
   - l'`UPDATE` de rattrapage ne touche **que les fondateurs encore dans leur fenêtre
     d'offre** : un fondateur hors offre déjà en Pro n'est jamais écrasé.

### À faire côté Supabase

Relancer **`supabase-SETUP-FINAL.sql`** (idempotent) dans le SQL Editor. Le rattrapage des
fondateurs encore en offre se fait tout seul au passage.

```sql
-- 1. doit renvoyer 0 ligne : aucun fondateur EN offre hors STARTER
select id, nom, plan from etablissements
 where est_fondateur = true
   and now() < date_creation + make_interval(days => coalesce(essai_jours, 14))
   and plan <> 'starter';

-- 2. fondateurs éligibles à l'upgrade (offre terminée)
select id, nom, plan, date_creation from etablissements
 where est_fondateur = true
   and now() >= date_creation + make_interval(days => coalesce(essai_jours, 7));

-- 3. places restantes
select public.places_fondateurs_restantes();
```

---

## NOUVEAU — Types d'établissement, SasPay, Score de crédit, FNE (2026)

### 1. Types d'établissement (`secteurs.js`)

Le menu déroulant « Créer un établissement » propose désormais **10 types** :

| Identifiant | Libellé | Postes de dépense |
|---|---|---|
| `restaurant` | Restaurant | 20 |
| `bar` | Bar | 20 |
| `maquis` | Maquis | 20 |
| `hotel` | Hôtel | 20 |
| `quincaillerie` | Quincaillerie | 20 |
| `boutique` | Boutique (épicerie / supérette) | 20 |
| `salon_beaute` | Salon de coiffure et beauté | 20 |
| `accessoires_telephone` | Boutique d'accessoires de téléphone | 20 |
| `vetements` | Boutique de vêtements | 20 |
| `pharmacie` | Pharmacie | 20 |

Chaque type propose désormais **20 frais de fonctionnement** : loyer,
salaires, factures, entretien, transport et prestations adaptés au métier.
Les biscuits, médicaments, vêtements, ciment et autres marchandises sont
séparés dans le catalogue de stock, pas dans les suggestions de dépenses.

> « La boutique de Diallo » est un **nom** d'établissement, pas un type : c'est
> une boutique (épicerie / supérette), elle hérite donc de la liste ci-dessus.

Le rattachement d'une dépense à son poste se fait :
1. par la colonne `transactions.poste_id` si elle est renseignée,
2. sinon par analyse de la désignation saisie (libellé exact, puis mot-clé).

Migration : **`supabase-types-etablissements.sql`** (élargit la contrainte
`secteur`, requalifie `restauration` → `restaurant`, ajoute `poste_id`).

### 2. SasPay remplace le QR code

L'ancien QR code Wave est **supprimé** (`WaveQR.js`, `wave-qr.png`). Le
paiement passe par un **lien SasPay** (Mobile Money + carte) :

```
VITE_SASPAY_PAYMENT_URL=https://…   # lien créé sur app.saspay.me
VITE_SASPAY_MARCHAND=ComptaCi
VITE_SASPAY_MODE=live               # "test" pour essayer
```

Sans `VITE_SASPAY_PAYMENT_URL`, l'app affiche « paiement en cours de
configuration » + le bouton WhatsApp (jamais de lien cassé). Voir
`saspay.js` pour les paramètres ajoutés au lien (`amount`, `reference`…).

### 3. Score de crédit (`creditScoring.js` + `ScoreCredit.jsx`)

Score sur 100 calculé côté client, présentable à une banque :

| Critère | Poids |
|---|---|
| Régularité des ventes | 25 |
| Tendance du chiffre d'affaires | 25 |
| Ratio dépenses / ventes | 20 |
| Ancienneté d'utilisation | 15 |
| Ponctualité de l'abonnement | 15 |

Paliers : **Bronze** (0-50), **Argent** (51-75), **Or** (76-100). La page
affiche aussi 6 objectifs de gestion et une **attestation** imprimable /
partageable. Calculé à partir des 90 derniers jours, avec comparaison de deux
fenêtres glissantes de 30 jours pour la tendance (pas de biais « mois en
cours »).

⚠️ Ce score aide à la décision, il n'est pas une décision de crédit : sa valeur
réelle suppose qu'un partenaire bancaire le reconnaisse.

### 4. Facture normalisée FNE (`fne.js` + `FacturationFNE.jsx`)

Réservée aux plans **Pro / Entreprise** (enjeu fiscal réel).

- **Prérequis administratif** : l'établissement doit être enrôlé sur la
  plateforme FNE de la DGI (numéro de contribuable + RCCM). ComptaCi ne peut
  pas s'y substituer — le module guide la démarche.
- **Mode brouillon** (sans clé API) : facture générée et archivée avec un
  numéro provisoire clairement marqué. Aucune donnée n'est envoyée.
- **Mode certifié** (clé API saisie) : transmission à l'API DGI, récupération
  du numéro normé, du cachet fiscal et du QR de vérification.
- **Archivage légal 10 ans** dans la table `factures_fne` (aucune politique
  `UPDATE` / `DELETE` : une facture est une pièce comptable).

Avant d'aller plus loin, il faut se procurer la documentation technique
officielle de l'API DGI et ajuster `chargeUtileFne()` dans `fne.js`.

Migration : **`supabase-fne.sql`**.

### 5. Aperçu local (`dev-preview/`)

```
npm run dev   →   http://localhost:5173/dev-preview/index.html
```

Rendu des nouveaux écrans (Score de crédit, Facturation FNE, types
d'établissement, abonnement) avec des données fictives, **sans connexion
Supabase**. Le dossier n'est pas inclus dans le build de production
(seuls `index.html` et `app.html` sont des entrées Vite).

### 6. Changer le type d'un établissement existant

Les comptes créés avant le découpage (valeur historique `restauration`) sont
requalifiés en `restaurant` par la migration. Un ancien compte qui est
réellement un bar, un maquis ou un hôtel peut corriger son type depuis
**Abonnement → « Type de votre établissement »** : la répartition des dépenses
et les suggestions de saisie basculent immédiatement sur les postes du nouveau
métier.

---

## NOUVEAU (suite) — Stock pré-rempli et landing page à jour

### 7. Import des produits de l'activité dans le stock

Un nouvel établissement démarrait avec un stock vide : il fallait tout saisir à
la main avant de pouvoir suivre quoi que ce soit.

**Stock → « Importer les produits de votre activité »** crée en un clic les
produits manquants du type d'établissement (quantité 0, seuil d'alerte 5). Pour
un salon de coiffure, on obtient immédiatement les références stockables (faux ongles,
vernis, perruques…) ; il ne reste qu'à saisir les quantités réelles.

- les produits déjà présents ne sont **jamais** dupliqués (comparaison sur la
  désignation, insensible à la casse) ;
- le bandeau affiche le nombre de produits manquants et disparaît quand tout est
  importé.

### 8. Landing page (`index.html`)

- **Bandeau des 10 types d'établissement** : restaurant, bar, maquis, hôtel,
  quincaillerie, boutique, salon de coiffure et beauté, accessoires téléphone,
  vêtements, pharmacie.
- **3 nouvelles cartes** : 20 dépenses types par métier · Score de crédit ·
  Facture normalisée (FNE).
- **Bloc « Vos chiffres peuvent vous ouvrir un crédit »** : les 4 familles de
  critères et leurs points (25 / 25 / 20 / 30).
- **4 questions FAQ ajoutées** : fin des 14 jours, type d'établissement absent,
  portée réelle du score de crédit, prise en charge de la FNE.
- Textes traduits en FR / EN / AR (`landing.js`).

### 9. Vérification automatisée

Un script de contrôle croise les clés `styles.*` utilisées dans `App.jsx` avec
celles définies dans l'objet `styles` : **215 utilisées, 0 manquante**. Les
composants sont également rendus en jsdom (Score de crédit, FNE, Stock,
Abonnement) : **0 erreur console**.

---

## NOUVEAU (suite) — Interface : thème sombre + vraie feuille de style CSS

### 10. Une feuille de style pour toute l'application (`ui.css`)

Les styles étaient jusqu'ici écrits **en ligne** dans les composants
(`style={styles.card}`). C'est pratique mais ça interdit les états
(`:hover`), les animations, le responsive fin et l'impression.

Deux fichiers ont été ajoutés :

| Fichier | Rôle |
| --- | --- |
| `ui.css` | **Design system** de l'app : jetons de couleur (`:root`), états des boutons et des champs, animations d'entrée, barres de défilement, infobulles des graphiques, règles responsive, feuille d'impression, classes utilitaires (`.cc-card`, `.cc-badge`, `.cc-btn-or`…). |
| `theme.js` | Miroir **JavaScript** de la palette (les graphiques SVG / Recharts n'acceptent pas `var(--…)`). Contient aussi `COULEURS_GRAPH`, `VOILE_BANNIERE`, `OMBRE*`. |

**Toutes les couleurs** des fichiers `App.jsx`, `AuthScreen.jsx`,
`ScoreCredit.jsx`, `FacturationFNE.jsx`, `PaiementSasPay.jsx` et
`PaiementEnAttente.jsx` pointent désormais vers les variables CSS
(`color: "var(--cc-texte)"`). Résultat : **pour changer l'ambiance de
l'application, il suffit de retoucher le bloc `:root` de `ui.css`** — aucune
modification de code.

### 11. Thème sombre élégant (bleu nuit + or)

- Fond bleu nuit profond avec deux halos discrets (or en haut à gauche, bleu
  en bas à droite), filigrane comptable doré (paramétrable dans `wallpaper.js`).
- Barre latérale en dégradé nuit, **barre dorée** sur la page active.
- Barre du haut en verre dépoli (`backdrop-filter`).
- Cartes bordées, ombres douces, **filet doré** en haut de chaque carte,
  animation d'entrée en cascade.
- **Bouton principal en dégradé or** (connexion, enregistrer une opération,
  ouvrir la caisse, payer, générer une facture…) ; boutons secondaires en
  bleu nuit en relief.
- Bandeaux photo des pages : voile sombre + titre or pâle.
- Graphiques, infobulles, listes déroulantes, champs autocomplétés : tout est
  harmonisé.
- Accessibilité : anneau de focus doré, `prefers-reduced-motion` respecté,
  feuille d'impression (factures/attestations) en noir sur blanc.

### 12. Aperçu des pages sans base de données

`/dev-preview/index.html` (après `npm run dev`) affiche **9 onglets** avec des
données fictives, dans le thème sombre : Tableau de bord, Saisie, Caisse,
Historique, Score de crédit, Facturation FNE, Types d'établissement,
Abonnement / type, Stock / import des postes.

### 13. Vérification automatisée

- Contrôle des variables : **39 jetons `--cc-*` définis, 0 référence
  manquante** dans les composants.
- Les 10 écrans (Dashboard, Saisie, Caisse, Historique, Stock, Abonnement,
  Score de crédit, FNE, Connexion, Paiement en attente) sont rendus en jsdom :
  **0 erreur console**.
- `npm run build` : OK (~5 s), `ui.css` génère ~11 kB de CSS.

> Note : la page d'accueil publique (`index.html`) conserve volontairement sa
> charte claire. Dis-moi si tu veux qu'elle passe elle aussi en sombre pour
> être cohérente avec l'application.

---

## NOUVEAU (suite) — SasPay : les 3 liens de paiement + webhook d'activation

### 14. Un lien SasPay par forfait

Les liens créés sur app.saspay.me sont **déjà intégrés** dans `saspay.js`
(aucune variable d'environnement à renseigner pour qu'ils fonctionnent) :

| Forfait | Lien de paiement | Tarif |
| --- | --- | --- |
| Starter | https://link.saspay.me/vmtjcwrgafk | 7 000 FCFA / mois |
| Pro | https://link.saspay.me/vrgqoaut3ba | 10 000 FCFA / mois |
| Entreprise | https://link.saspay.me/zszja0kudmy | 20 000 FCFA / mois |

- Le montant est **fixé par le lien SasPay** : l'application n'ajoute donc que
  les paramètres de suivi (référence, établissement, téléphone du payeur).
- Ils restent surchargeables par `VITE_SASPAY_URL_STARTER` / `_PRO` /
  `_ENTREPRISE` (pratique pour tester avec des liens « test »).
- Référence envoyée : `CCI-<6 premiers caractères de l'ID>-<AAAAMM>-<forfait>`
  — le dernier segment est relu par le webhook pour créditer le bon forfait.

### 15. La page « paiement Wave » est remplacée

- `PaiementWave.jsx` → **supprimé**.
- `PaiementSasPay.jsx` → le reprend intégralement (offre fondateurs, choix du
  forfait, comparatif, confirmation, secours WhatsApp) en affichant désormais
  **le lien SasPay du forfait sélectionné** (cliquable + copiable) et en
  basculant sur le bloc « j'ai payé » dès que le paiement est lancé.
- `App.jsx` (page Abonnement) et `PaiementEnAttente.jsx` utilisent le nouveau
  composant.
- 4 nouvelles clés de traduction FR/EN/AR (`paiement_saspay_lien`,
  `paiement_saspay_copier_lien`, `paiement_saspay_lien_copie`,
  `paiement_saspay_apres_paiement`).

### 16. Webhook SasPay : activation automatique de l'abonnement

**Fichier** : `supabase/functions/webhook-saspay/index.ts` (Edge Function Deno).
Le secret `SASPAY_WEBHOOK_SECRET` est **déjà configuré sur Supabase** : la
fonction le lit elle-même via `Deno.env.get`, il n'y a rien à coller dans le
code ni dans `.env`.

Ce qu'elle fait :
1. vérifie la signature **HMAC-SHA256** du corps brut (en-tête
   `x-saspay-signature`, formats `sha256=…` ou hex acceptés), comparaison à
   temps constant ;
2. lit un payload souple (plusieurs noms de champs reconnus : SasPay n'a pas
   encore publié son format définitif) ;
3. appelle la RPC SQL `traiter_paiement_saspay` qui, **de façon idempotente** :
   - retrouve l'établissement (`business_id` → demande en attente → préfixe de
     la référence `CCI-XXXXXX`) ;
   - journalise la notification dans `paiements_saspay` ;
   - **active l'abonnement** (`abonnement_actif = true`, `plan`, `abonne_le`,
     `abonnement_expire_le = now() + 30 jours`) ;
   - clôture la demande manuelle correspondante dans `demandes_paiement`.

**Mise en route (3 commandes)** :

```bash
supabase secrets set SASPAY_WEBHOOK_SECRET=xxxxx      # déjà fait
supabase functions deploy webhook-saspay --no-verify-jwt
# puis, dans le tableau de bord SasPay :
#   URL du webhook = https://<project-ref>.supabase.co/functions/v1/webhook-saspay
```

**Migration SQL à exécuter** : `supabase-saspay-webhook.sql`
(table `paiements_saspay`, colonnes `abonne_le` / `abonnement_expire_le`,
fonctions `resoudre_etablissement_par_prefixe` et `traiter_paiement_saspay`,
vue de contrôle `v_paiements_saspay`).

Contrôle rapide : `select * from v_paiements_saspay limit 20;`
