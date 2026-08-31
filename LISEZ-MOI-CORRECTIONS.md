# ComptaCi — Corrections & améliorations (à lire avant déploiement)

## 1) ÉTAPE OBLIGATOIRE — corriger la base de données

Tous les bugs signalés (ajout de produit en stock impossible, erreur à la
saisie d'un mouvement, bouton d'invitation de gérant invisible, fournisseurs
et caisse "inexistants", **boutons sans réaction après connexion**) viennent
du fait que les tables/colonnes/politiques nécessaires n'existent pas encore
dans ta base Supabase.

**Va dans Supabase → SQL Editor → colle et exécute, DANS L'ORDRE :**

1. **`supabase-MASTER-COMPLET.sql`** (une seule fois) — crée toutes les
   tables, colonnes et politiques de base.
2. **`supabase-fix-rls-actions.sql`** (une seule fois) — corrige les
   autorisations d'écriture :
   - les **gérants** peuvent désormais saisir ventes/dépenses, gérer le
     stock, les fournisseurs et la caisse (avant, les politiques RLS
     bloquaient leurs écritures → les boutons semblaient morts) ;
   - l'**inscription d'un établissement** crée automatiquement la ligne
     « membres » du propriétaire (sinon l'insertion échouait à cause d'un
     contrôle RLS circulaire).

Les deux scripts sont 100% idempotents : on peut les relancer sans risque,
ils ne créent que ce qui manque et ne touchent pas aux données existantes.

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
