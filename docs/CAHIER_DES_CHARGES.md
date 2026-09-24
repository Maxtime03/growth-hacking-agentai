# Pluq Opportunity Finder — cahier des charges MVP

## 1. Objectif

Créer une application web interne qui repère, dans une région choisie en Belgique, en France ou aux Pays-Bas, les établissements susceptibles d'avoir un parking mais aucune borne de recharge visible. L'application qualifie les opportunités, recherche leurs coordonnées professionnelles et prépare à Maxime une fiche d'appel exploitable.

Le système ne doit jamais présenter « aucune borne » comme une certitude sur la seule base d'une source. Il utilise trois statuts : **borne détectée**, **aucune borne détectée**, **à vérifier**.

## 2. Utilisateur et résultat attendu

L'utilisateur choisit :

- le pays, la région, la province/département ou une zone dessinée sur une carte ;
- les catégories d'établissements ;
- le rayon de contrôle des bornes ;
- le nombre maximal de prospects ;
- une exécution immédiate ou récurrente.

En sortie, il obtient une liste triée d'opportunités avec : établissement, adresse, carte, catégorie, site, téléphone, e-mail générique, décideur éventuel, estimation du parking, bornes détectées sur le site et autour, score, niveau de confiance, sources, argumentaire et prochaine action.

## 3. Cibles prioritaires

1. Hôtels, resorts et lieux événementiels.
2. Cinémas, padels, salles de sport et centres de loisirs.
3. Centres commerciaux, grandes surfaces et retail parks.
4. Restaurants à forte fréquentation ou avec parking.
5. Coworkings, immeubles de bureaux et sièges d'entreprise.
6. Cliniques, maisons de repos et centres médicaux.
7. Concessions, flottes, entreprises logistiques et parcs d'activités.

Chaque recherche combine catégorie + localité, avec déduplication par nom, adresse, domaine et coordonnées GPS.

## 4. Sources et rôle de chaque outil

| Besoin | Source recommandée | Usage |
|---|---|---|
| Établissements | Apify Google Maps Scraper | Nom, adresse, GPS, téléphone, site, catégorie, avis et parfois contacts publics |
| Bornes | Open Charge Map API | Bornes publiques ou référencées dans un rayon et proximité avec le prospect |
| Vérification | Chargemap + site du prospect | Contrôle humain des meilleurs dossiers |
| Parking | Données Google, texte du site, photos et vue satellite si autorisée | Indice de parking, jamais certitude automatique |
| E-mail | Site officiel puis outil d'enrichissement | Priorité aux adresses professionnelles publiées |
| Décideur | Apollo ou source professionnelle autorisée | Directeur, responsable immobilier, facility manager ou direction générale |
| Base commerciale | Supabase au cœur ; synchronisation Airtable/Pipedrive possible | Historique, statuts, recherches et anti-doublons |

Open Charge Map est un filtre, pas une preuve absolue. Une borne privée non publiée peut exister. Le contrôle doit comparer la distance GPS à l'établissement : par exemple, une borne à moins de 80 mètres est « probablement sur site », entre 80 et 250 mètres « à vérifier », et au-delà « à proximité ».

## 5. Workflow automatisé

1. L'utilisateur crée une campagne et sélectionne zone, catégories et cadence.
2. Apify collecte les établissements et coordonnées publiques.
3. Le backend normalise les adresses et supprime les doublons.
4. Pour chaque GPS, Open Charge Map recherche les bornes à 100 m, 500 m, 1 km et 2 km.
5. Le moteur classe la situation : sur site probable, voisinage, zone sous-équipée ou incertaine.
6. L'enrichissement récupère e-mail professionnel, téléphone et décideur éventuel.
7. L'IA lit le site et produit une analyse factuelle avec sources.
8. Le moteur calcule score et confiance séparément.
9. Seuls les dossiers dépassant les seuils apparaissent dans la file d'appels.
10. L'utilisateur valide, rejette, appelle, programme un rappel ou prépare un e-mail.

Les recherches récurrentes sont gérées par un ordonnanceur. Apify peut lancer des tâches selon une fréquence et prévenir l'application par webhook une fois le traitement terminé.

## 6. Score d'opportunité

Score commercial sur 100 :

| Critère | Points max |
|---|---:|
| Parking probable et capacité estimée | 25 |
| Aucune borne détectée sur site | 25 |
| Faible couverture dans un rayon pertinent | 15 |
| Temps de stationnement élevé | 10 |
| Type d'établissement prioritaire | 10 |
| Taille/activité compatibles avec l'investissement | 10 |
| Contact exploitable | 5 |

Le **score de confiance**, distinct, dépend de la fraîcheur des données, du nombre de sources concordantes, de la précision GPS, de la présence de photos ou d'une page parking et de la qualité des coordonnées. Un prospect peut avoir un score commercial élevé mais rester « à vérifier » si la confiance est faible.

## 7. Écrans de l'application

### Tableau de bord

Campagnes actives, nouvelles opportunités, dossiers à appeler, rappels du jour, taux de qualification et carte de densité.

### Nouvelle recherche

Pays, région, rayon/polygone, catégories, nombre de résultats, seuil du score, langue, cadence et budget maximal de collecte.

### Carte et liste

Marqueurs colorés, filtres, tri, bornes environnantes, vue par clusters et sélection multiple.

### Fiche opportunité

- résumé en 20 secondes ;
- pourquoi le site semble intéressant ;
- bornes trouvées et distances ;
- parking et niveau de confiance ;
- téléphone, e-mail, site et décideur ;
- sources cliquables et date de vérification ;
- script d'appel personnalisé ;
- brouillon d'e-mail ;
- bouton WhatsApp manuel ;
- notes, statut, rappel et historique.

### File d'appels

Un prospect à la fois, téléphone bien visible, pitch, objections probables, informations décisives, résultat de l'appel et prochain suivi.

### Planificateur

Recherches quotidiennes, hebdomadaires ou mensuelles, quotas, dernière exécution, prochaine exécution et alertes d'échec.

## 8. Statuts commerciaux

`Nouveau` → `À vérifier` → `Qualifié` → `À appeler` → `Appelé` → `Rendez-vous` → `Proposition` → `Gagné/Perdu`.

Motifs de rejet obligatoires : borne existante, pas de parking, établissement fermé, doublon, mauvais profil, coordonnées introuvables ou refus.

## 9. Fiche d'appel générée par l'IA

La fiche doit contenir uniquement des informations vérifiables :

- activité et taille apparente ;
- caractéristiques du lieu et du parking ;
- couverture de recharge observée ;
- hypothèse commerciale clairement nommée comme hypothèse ;
- personne ou fonction à demander ;
- pitch de 30 secondes ;
- trois questions de découverte ;
- objections probables ;
- liens sources et date d'analyse.

Exemple de notification : « Hôtel X à Wavre — score 84/100, confiance 78 %. Parking probable, aucune borne détectée à moins de 100 m, téléphone disponible. Action : appeler la direction ou le facility manager. »

## 10. Communication et conformité

- WhatsApp : pas d'envoi froid automatique. Générer le texte et ouvrir une conversation manuelle ; automatiser uniquement pour les contacts ayant donné leur consentement et avec les modèles approuvés requis.
- E-mail : utiliser uniquement des coordonnées professionnelles, identifier l'expéditeur, expliquer la pertinence, prévoir une opposition simple et conserver la source et la date de collecte.
- Prospection : appliquer les règles nationales et le RGPD, limiter la collecte au nécessaire, documenter l'intérêt légitime et traiter les demandes d'opposition.
- Ne pas contacter automatiquement un numéro personnel déduit ou non publié à titre professionnel.

## 11. Stack recommandée

- **Application** : Next.js + TypeScript + Tailwind.
- **Backend et données** : Supabase Postgres, Auth, Storage et Row Level Security.
- **Carte** : Mapbox ou Leaflet/OpenStreetMap.
- **Collecte** : Apify.
- **Bornes** : Open Charge Map API, avec cache local et date de dernière vérification.
- **Orchestration** : n8n pour le MVP ; fonctions backend pour les traitements critiques.
- **IA** : modèle structuré avec sortie JSON et citations ; le fournisseur reste remplaçable.
- **E-mail** : Resend, Gmail ou Microsoft selon le domaine commercial.
- **CRM** : Airtable pour le MVP rapide, puis Pipedrive si Pluq veut centraliser son pipeline existant.
- **Monitoring** : Sentry + journal des exécutions et coûts.

## 12. Codex ou Claude

Recommandation : **Codex pour construire le produit dans un dépôt Git**, car le travail demande de créer et modifier plusieurs fichiers, exécuter les tests, connecter les API et itérer sur toute l'application. Claude Code pourrait également convenir, mais il n'est pas nécessaire de combiner les deux au départ.

Le moteur IA utilisé dans l'application doit être indépendant du logiciel qui écrit le code. On peut construire avec Codex et utiliser ensuite OpenAI, Claude ou un autre modèle pour générer les fiches d'appel. Le choix du modèle d'exécution se fera sur un test de 50 prospects : exactitude factuelle, qualité du pitch, coût et taux de JSON valide.

## 13. Phases de réalisation

### Phase 1 — Prototype de validation

Une zone (Brabant wallon), trois catégories, collecte de 100 à 300 établissements, contrôle Open Charge Map, score, tableau de résultats et export CSV. Objectif : mesurer les faux positifs avant de construire tout le CRM.

### Phase 2 — MVP commercial

Authentification, campagnes sauvegardées, carte, fiche prospect, file d'appels, e-mails en brouillon, rappels, historique et planification.

### Phase 3 — Industrialisation

Belgique, France et Pays-Bas ; rôles équipe ; synchronisation CRM ; enrichissement avancé ; mesure des conversions ; budgets et quotas ; règles par pays.

## 14. Critères d'acceptation du prototype

- Une recherche région + catégorie produit une liste dédupliquée.
- Chaque prospect contient ses sources et dates de collecte.
- Les distances vers les bornes sont calculées côté serveur.
- L'interface distingue absence détectée et absence certaine.
- Le score et le score de confiance sont explicables.
- Un prospect peut être validé, rejeté ou ajouté à la file d'appels.
- Une fiche d'appel peut être générée sans invention de faits.
- Une exécution peut être planifiée et relancée sans créer de doublons.
- Les coûts et erreurs de chaque campagne sont visibles.

## 15. Première expérience pilote recommandée

Zone : Brabant wallon. Catégories : hôtels, padels et centres d'affaires. Volume : 150 prospects maximum. Contrôle : 100 m pour « sur site », 500 m et 2 km pour la couverture locale. Validation manuelle des 30 meilleurs résultats avec Chargemap et le site officiel. Le résultat permettra de calibrer les seuils avant la France et les Pays-Bas.

