/** Suggestions de frais de fonctionnement, jamais de transactions pré-enregistrées.
 * Les marchandises et matières premières sont gérées séparément dans le stock.
 * Les achats réels restent saisissables librement, sans être suggérés ici.
 */
export const CATEGORIES_DEPENSES = [
  { id: 'charges_fixes', label: 'Charges fixes & factures' },
  { id: 'personnel', label: 'Personnel & cotisations' },
  { id: 'entretien_exploitation', label: 'Entretien & réparations' },
  { id: 'logistique', label: 'Transport & manutention' },
  { id: 'services_exterieurs', label: 'Services & prestations' },
  { id: 'consommables_exploitation', label: 'Consommables de fonctionnement' },
  { id: 'approvisionnement', label: 'Achats de marchandises / matières premières' },
  { id: 'autre', label: 'Autre dépense' },
];

// Dix frais courants, contextualisés pour chaque activité.
function fraisCommuns(local, equipe, energie) {
  return [
    ['loyer', `Loyer ${local}`, 'charges_fixes', ['loyer', 'bail']],
    ['electricite', `Facture d’électricité (${energie})`, 'charges_fixes', ['facture electricite', 'facture cie']],
    ['eau', `Facture d’eau ${local}`, 'charges_fixes', ['facture eau', 'sodeci']],
    ['salaires', `Salaires ${equipe}`, 'personnel', ['salaires', 'salaire']],
    ['cotisations', `Cotisations sociales ${equipe}`, 'personnel', ['cotisations sociales', 'cnps']],
    ['telecom', `Téléphone & Internet ${local}`, 'charges_fixes', ['abonnement internet', 'facture telephone']],
    ['assurance', `Assurance professionnelle ${local}`, 'charges_fixes', ['assurance professionnelle']],
    ['paiement', 'Frais bancaires & commissions Mobile Money', 'services_exterieurs', ['frais bancaires', 'commission mobile money']],
    ['taxes', `Taxes d’exploitation ${local}`, 'charges_fixes', ['patente', 'taxes exploitation']],
    ['nettoyage', `Prestation de nettoyage ${local}`, 'services_exterieurs', ['prestation nettoyage']],
  ];
}

const ACTIVITES = {
  restaurant: {
    contexte: ['du restaurant', 'des cuisiniers & serveurs', 'cuisine & salle'],
    frais: [
      ['gaz_cuisson', 'Recharge de gaz pour la cuisson', 'charges_fixes'],
      ['hotte', 'Dégraissage des hottes de cuisine', 'entretien_exploitation'],
      ['froid', 'Maintenance des réfrigérateurs de cuisine', 'entretien_exploitation'],
      ['four', 'Réparation des fours & réchauds', 'entretien_exploitation'],
      ['vaisselle', 'Détergent pour la vaisselle du restaurant', 'consommables_exploitation'],
      ['linge', 'Blanchisserie des nappes & tabliers', 'services_exterieurs'],
      ['nuisibles', 'Désinsectisation de la cuisine', 'services_exterieurs'],
      ['dechets', 'Collecte des déchets alimentaires', 'services_exterieurs'],
      ['livraison', 'Frais de coursier pour les repas livrés', 'logistique'],
      ['hygiene', 'Formation du personnel à l’hygiène alimentaire', 'personnel'],
    ],
  },
  bar: {
    contexte: ['du bar', 'des barmen & serveurs', 'frigos & éclairage'],
    frais: [
      ['froid', 'Maintenance des frigos du bar', 'entretien_exploitation'],
      ['sonorisation', 'Location de sonorisation pour les soirées', 'services_exterieurs'],
      ['animation', 'Cachet du DJ & animation musicale', 'services_exterieurs'],
      ['droits', 'Droits de diffusion musicale', 'charges_fixes'],
      ['securite', 'Prestation de sécurité des soirées', 'services_exterieurs'],
      ['transport', 'Frais de transport des casiers de boissons', 'logistique'],
      ['verres', 'Détergent pour le lavage des verres', 'consommables_exploitation'],
      ['sanitaires', 'Désinfection des sanitaires du bar', 'services_exterieurs'],
      ['dechets', 'Collecte des déchets du bar', 'services_exterieurs'],
      ['clim', 'Entretien des climatiseurs du bar', 'entretien_exploitation'],
    ],
  },
  maquis: {
    contexte: ['du maquis', 'des cuisiniers & serveuses', 'terrasse & congélateurs'],
    frais: [
      ['combustible', 'Charbon consommé pour les grillades', 'consommables_exploitation'],
      ['grils', 'Entretien des grils & braiseuses', 'entretien_exploitation'],
      ['froid', 'Réparation des congélateurs du maquis', 'entretien_exploitation'],
      ['terrasse', 'Nettoyage approfondi de la terrasse', 'services_exterieurs'],
      ['animation', 'Cachet des musiciens du maquis', 'services_exterieurs'],
      ['securite', 'Gardiennage du maquis la nuit', 'services_exterieurs'],
      ['transport', 'Frais de transport des approvisionnements', 'logistique'],
      ['dechets', 'Enlèvement des déchets de grillades', 'services_exterieurs'],
      ['nuisibles', 'Dératisation des réserves du maquis', 'services_exterieurs'],
      ['ombrage', 'Réparation des bâches & parasols de terrasse', 'entretien_exploitation'],
    ],
  },
  hotel: {
    contexte: ['de l’hôtel', 'de la réception & des femmes de chambre', 'chambres & climatisation'],
    frais: [
      ['blanchisserie', 'Blanchisserie des draps & serviettes de l’hôtel', 'services_exterieurs'],
      ['clim', 'Maintenance des climatiseurs des chambres', 'entretien_exploitation'],
      ['plomberie', 'Réparation de la plomberie des chambres', 'entretien_exploitation'],
      ['securite', 'Gardiennage de l’hôtel', 'services_exterieurs'],
      ['reservation', 'Commissions des plateformes de réservation', 'services_exterieurs'],
      ['logiciel', 'Abonnement au logiciel de gestion hôtelière', 'services_exterieurs'],
      ['nuisibles', 'Désinsectisation des chambres', 'services_exterieurs'],
      ['groupe', 'Carburant du groupe électrogène de l’hôtel', 'charges_fixes'],
      ['incendie', 'Contrôle des extincteurs de l’hôtel', 'entretien_exploitation'],
      ['navette', 'Frais de navette pour les clients de l’hôtel', 'logistique'],
    ],
  },
  quincaillerie: {
    contexte: ['de la quincaillerie & du dépôt', 'des vendeurs & magasiniers', 'magasin & dépôt'],
    frais: [
      ['transport', 'Frais de livraison des matériaux aux clients', 'logistique'],
      ['manutention', 'Prestation de chargement & déchargement au dépôt', 'logistique'],
      ['camion', 'Location de camion pour les livraisons', 'logistique'],
      ['carburant', 'Carburant du véhicule de livraison', 'logistique'],
      ['vehicule', 'Entretien du véhicule de livraison', 'entretien_exploitation'],
      ['levage', 'Maintenance du matériel de manutention', 'entretien_exploitation'],
      ['securite', 'Gardiennage du dépôt de matériaux', 'services_exterieurs'],
      ['rayonnages', 'Réparation des rayonnages de la quincaillerie', 'entretien_exploitation'],
      ['poussiere', 'Dépoussiérage professionnel du dépôt', 'services_exterieurs'],
      ['incendie', 'Contrôle des extincteurs de la quincaillerie', 'entretien_exploitation'],
    ],
  },
  boutique: {
    contexte: ['de la boutique', 'des vendeurs de la boutique', 'éclairage & congélateur'],
    frais: [
      ['transport', 'Frais de transport depuis le grossiste', 'logistique'],
      ['livraison', 'Frais de livraison des commandes clients', 'logistique'],
      ['froid', 'Réparation du congélateur de la boutique', 'entretien_exploitation'],
      ['rayonnages', 'Entretien des étagères de la boutique', 'entretien_exploitation'],
      ['securite', 'Gardiennage de la boutique', 'services_exterieurs'],
      ['nuisibles', 'Dératisation de la réserve de la boutique', 'services_exterieurs'],
      ['dechets', 'Collecte des déchets de la boutique', 'services_exterieurs'],
      ['tickets', 'Rouleaux de tickets pour la caisse', 'consommables_exploitation'],
      ['caisse', 'Maintenance de la caisse enregistreuse', 'entretien_exploitation'],
      ['enseigne', 'Réparation de l’enseigne de la boutique', 'entretien_exploitation'],
    ],
  },
  salon_beaute: {
    contexte: ['du salon de beauté', 'des coiffeurs & esthéticiennes', 'séchoirs & climatisation'],
    frais: [
      ['linge', 'Blanchisserie des serviettes & capes du salon', 'services_exterieurs'],
      ['desinfection', 'Désinfectant pour les outils du salon', 'consommables_exploitation'],
      ['tondeuses', 'Maintenance des tondeuses professionnelles', 'entretien_exploitation'],
      ['sechoirs', 'Réparation des casques & sèche-cheveux', 'entretien_exploitation'],
      ['bacs', 'Réparation de la plomberie des bacs à shampoing', 'entretien_exploitation'],
      ['fauteuils', 'Entretien des fauteuils du salon', 'entretien_exploitation'],
      ['formation', 'Formation technique des coiffeurs', 'personnel'],
      ['publicite', 'Publicité du salon sur les réseaux sociaux', 'services_exterieurs'],
      ['reservation', 'Abonnement au service de prise de rendez-vous', 'services_exterieurs'],
      ['dechets', 'Collecte des déchets du salon', 'services_exterieurs'],
    ],
  },
  accessoires_telephone: {
    contexte: ['de la boutique téléphonique', 'des vendeurs & techniciens', 'vitrines & atelier'],
    frais: [
      ['transport', 'Frais de transport des colis d’accessoires', 'logistique'],
      ['livraison', 'Frais de coursier pour les commandes clients', 'logistique'],
      ['vitrines', 'Réparation des vitrines de présentation', 'entretien_exploitation'],
      ['securite', 'Abonnement à la télésurveillance de la boutique', 'services_exterieurs'],
      ['outils', 'Maintenance des outils de réparation téléphonique', 'entretien_exploitation'],
      ['logiciel', 'Abonnement au logiciel de diagnostic téléphonique', 'services_exterieurs'],
      ['formation', 'Formation des techniciens de réparation', 'personnel'],
      ['publicite', 'Publicité en ligne de la boutique téléphonique', 'services_exterieurs'],
      ['dechets', 'Collecte spécialisée des déchets électroniques', 'services_exterieurs'],
      ['tickets', 'Rouleaux de tickets pour les reçus clients', 'consommables_exploitation'],
    ],
  },
  vetements: {
    contexte: ['de la boutique de vêtements', 'des vendeurs de prêt-à-porter', 'cabines & vitrines'],
    frais: [
      ['transport', 'Frais de transport des colis de vêtements', 'logistique'],
      ['livraison', 'Frais de livraison des commandes de vêtements', 'logistique'],
      ['pressing', 'Prestation de pressing des articles exposés', 'services_exterieurs'],
      ['retouches', 'Prestation de retouches confiée à un couturier', 'services_exterieurs'],
      ['photo', 'Séance photo du catalogue de vêtements', 'services_exterieurs'],
      ['publicite', 'Publicité des collections sur les réseaux sociaux', 'services_exterieurs'],
      ['cabines', 'Réparation des cabines d’essayage', 'entretien_exploitation'],
      ['portants', 'Entretien des portants & présentoirs', 'entretien_exploitation'],
      ['securite', 'Maintenance du système antivol de la boutique', 'entretien_exploitation'],
      ['etiquettes', 'Impression des étiquettes de prix', 'consommables_exploitation'],
    ],
  },
  pharmacie: {
    contexte: ['de la pharmacie', 'des pharmaciens & préparateurs', 'officine & chaîne du froid'],
    frais: [
      ['froid', 'Maintenance du réfrigérateur pharmaceutique', 'entretien_exploitation'],
      ['temperature', 'Étalonnage des sondes de température', 'entretien_exploitation'],
      ['dechets', 'Collecte agréée des déchets pharmaceutiques', 'services_exterieurs'],
      ['securite', 'Gardiennage de nuit de la pharmacie', 'services_exterieurs'],
      ['logiciel', 'Abonnement au logiciel de gestion officinale', 'services_exterieurs'],
      ['formation', 'Formation continue du personnel officinal', 'personnel'],
      ['transport', 'Frais de transport sous température contrôlée', 'logistique'],
      ['groupe', 'Entretien du groupe électrogène de la pharmacie', 'entretien_exploitation'],
      ['nuisibles', 'Désinsectisation des réserves de la pharmacie', 'services_exterieurs'],
      ['incendie', 'Contrôle des extincteurs de la pharmacie', 'entretien_exploitation'],
    ],
  },
};

export const DEPENSES_PAR_ACTIVITE = Object.fromEntries(
  Object.entries(ACTIVITES).map(([secteur, { contexte, frais }]) => [secteur, {
    categories: CATEGORIES_DEPENSES,
    // Nouveaux identifiants : ne jamais rebaptiser une ancienne dépense de marchandise.
    postes: [...fraisCommuns(...contexte), ...frais].map(([id, label, categorie, mots = []]) => ({
      id: `fonctionnement_${id}`, label, categorie, mots,
    })),
  }])
);
