# ComptaCi — Corrections & améliorations (à lire avant déploiement)

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
- tout nouvel établissement démarre avec le plan Starter gratuit pendant
  **7 jours**, avec 1 gérant invitable ;
- au bout de 7 jours, l'accès est bloqué automatiquement et les 3 plans
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
- Essai gratuit passé à 7 jours partout côté interface (au lieu de 3).
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

## Tarifs & offre Fondateurs (règle en vigueur)

| Formule | Prix | Pour qui |
|---|---|---|
| Starter | **7 000 FCFA/mois** | Tout le monde — **tarif verrouillé à vie pour les Fondateurs** |
| Pro | **10 000 FCFA/mois** | Tout le monde, fondateurs compris |
| Entreprise | 20 000 FCFA/mois | Tout le monde, fondateurs compris |

**Offre Fondateurs = les 100 premiers établissements : leur plan STARTER reste à
7 000 FCFA/mois à vie, mais les trois forfaits sont affichés et souscriptibles,
fondateurs compris.**

- Un établissement fondateur (`est_fondateur = true`) voit les **trois forfaits**
  (Starter, Pro, Entreprise) sur la page Abonnement : le Starter au tarif verrouillé
  `tarif_verrouille = 7 000` FCFA/mois, Pro et Entreprise aux tarifs officiels.
- Le 101ᵉ établissement créé n'est pas fondateur et garde aussi les trois forfaits.

### Où la règle est appliquée

1. **`PaiementWave.jsx`** — `plansDisponibles()` renvoie toujours `["starter", "pro",
   "entreprise"]` ; seul le tarif du plan **Starter** d'un fondateur utilise
   `tarif_verrouille` (7 000 FCFA) ; la demande de paiement enregistre le plan choisi.
2. **`supabase-SETUP-FINAL.sql` / `supabase-MASTER-COMPLET.sql` / `supabase-fondateurs.sql`** :
   - `appliquer_offre_fondateur()` marque les 100 premiers établissements comme
     fondateurs, verrouille `tarif_verrouille = 7000` et les fait démarrer sur
     `starter` (verrou `pg_advisory_xact_lock` contre les inscriptions simultanées) ;
   - **plus de** `empecher_sortie_plan_fondateur()` ni
     `forcer_plan_fondateur_demande()` : un fondateur peut passer à Pro/Entreprise,
     `valider_paiement()` applique le plan demandé.
3. **`supabase-plans-tous-disponibles.sql`** — migration idempotente à exécuter sur une
   base déjà en place : elle supprime les deux triggers de verrouillage fondateurs.

### À faire côté Supabase

Exécuter **`supabase-plans-tous-disponibles.sql`** dans le SQL Editor
(idempotent). Pour une base neuve, exécuter directement
**`supabase-SETUP-FINAL.sql`** (version mise à jour, sans les verrous).

```sql
-- Vérification : plus aucun trigger de verrouillage fondateur
select tgname from pg_trigger
 where tgname in ('trg_fondateur_plan_starter', 'trg_demandes_paiement_fondateur');

-- Places restantes sur l'offre Fondateurs
select public.places_fondateurs_restantes();
```
