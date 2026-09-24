# Net.AI OS — lancement sur Windows

## Installation

1. Décompressez le dossier dans `I:\Documents\NET-AI-OS`.
2. Ouvrez PowerShell en mode normal.
3. Autorisez les scripts pour cette session uniquement :

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

4. Placez-vous dans le projet :

```powershell
cd I:\Documents\NET-AI-OS
```

5. Lancez l'installation :

```powershell
.\INSTALL-NET-AI-OS.ps1
```

6. Ouvrez `.env.local` et renseignez les clés demandées.
7. Démarrez l'application :

```powershell
.\START-NET-AI-OS.ps1
```

8. Ouvrez `http://localhost:3000`.

## Clés indispensables

- `APIFY_API_TOKEN` : recherche d'entreprises via l'Actor Google Maps Scraper.
- `OPEN_CHARGE_MAP_API_KEY` : contrôle des bornes de recharge.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` : affichage de la vraie carte interactive Google Maps.
- `OPENAI_API_KEY` : analyse commerciale et génération de l'icebreaker.

## Connexion des comptes Gmail / Google Workspace

Dans Google Cloud, activez l'API Gmail puis créez un identifiant OAuth de type **Application Web**.
Ajoutez cette URI de redirection autorisée :

```text
http://127.0.0.1:3000/api/email/google/callback
```

Ajoutez ensuite dans `.env.local` :

```text
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:3000/api/email/google/callback
TOKEN_ENCRYPTION_KEY=une-longue-phrase-secrete-unique
```

Le projet Supabase utilisé est `net-ai-leados`. Ajoutez également son URL et sa clé serveur dans
`NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`. La clé serveur ne doit jamais être
préfixée par `NEXT_PUBLIC_`.

La clé Google Maps doit autoriser `http://localhost:3000/*` et utiliser la Maps JavaScript API. Elle est différente de la clé Apify.

## Arrêter le serveur

Dans la fenêtre PowerShell qui exécute le projet, appuyez sur `Ctrl+C`.
