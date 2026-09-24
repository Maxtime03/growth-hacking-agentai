# Net.AI OS — Revenue Intelligence

CRM multi-client pour Net.AI, Pluq, Lexicon et Profitflow : Radar géographique, enrichissement, file d'appels, campagnes Gmail, suivi et analyses.

## État du projet

Le Radar utilise Google Maps pour sélectionner une ville ou une zone, Apify pour collecter les établissements et leurs coordonnées publiques, Open Charge Map pour contrôler les bornes et Supabase pour conserver les recherches et leurs listes. Les volumes disponibles vont de 10 à 5 000 leads. Les recherches importantes sont asynchrones : la page suit leur progression et recharge automatiquement la liste enregistrée.

Chaque ligne ouvre une fiche prospect. Le bouton d'enrichissement relance Apify sur l'établissement, recherche jusqu'à trois décideurs, vérifie les e-mails lorsque le fournisseur le permet, enrichit un profil LinkedIn public détecté et produit un briefing d'appel avec OpenAI. Les données absentes ne sont pas inventées et doivent être vérifiées avant contact.

## Développement

```bash
npm run install:ci
npm run dev
```

Créer un fichier `.env.local` à partir de `.env.example`. Ne jamais versionner les clés API.

## Configuration indispensable

```text
NEXT_PUBLIC_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
TOKEN_ENCRYPTION_KEY=une_phrase_longue_unique_et_secrete
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:3000/api/email/google/callback
```

`SUPABASE_SERVICE_ROLE_KEY` reste accepté à la place de `SUPABASE_SECRET_KEY`. La clé serveur ne doit jamais porter le préfixe `NEXT_PUBLIC_` ni être commitée.

Après la mise à jour, reconnecter une fois chaque compte Google depuis **Campagnes** afin d'accorder la lecture et l'envoi Gmail.

## Intégrations actives

- Apify : collecte des établissements et coordonnées publiques.
- Open Charge Map : détection des points de recharge.
- Supabase : recherches, listes, leads enrichis et historique persistant.
- Google OAuth/Gmail : connexion, inbox et envoi manuel contrôlé.

## Sécurité

- Jetons Google de reconnexion chiffrés en AES-GCM avant stockage.
- Secrets Supabase et OAuth exclusivement côté serveur.
- Aucun email envoyé automatiquement : relecture et confirmation obligatoires.
- Données manquantes non inventées et sources publiques vérifiables.
