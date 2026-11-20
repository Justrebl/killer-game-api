# Mission Pierrot

Application mobile pour un jeu de l'assassin à killer unique. Pierrot est le seul utilisateur authentifié; les autres personnes sont des cibles visibles seulement après connexion. GitHub Pages sert le frontend et Cloudflare Workers, D1 et R2 servent l'API et le stockage privé.

## Architecture

- `docs/`: frontend statique publié avec GitHub Pages.
- `worker/src/index.js`: API protégée par un mot de passe unique et une session temporaire.
- `worker/migrations/0001_initial.sql`: événement, cibles, victoires, sessions et limitations de débit.
- `worker/event.local.json`: noms, défis et mot de passe réels; ce fichier reste privé et ignoré par Git.
- Cloudflare D1: métadonnées et état du jeu.
- Cloudflare R2: photos chiffrées AES-GCM, jamais le JPEG original.

La liste des décisions est conservée dans [docs/decisions.md](docs/decisions.md).

## Dépendances

Installer Node.js LTS puis exécuter:

```powershell
npm install
```

## Vérifications locales

Ces commandes ne modifient pas les ressources Cloudflare distantes:

```powershell
npm run check
npm test
$env:PLAYWRIGHT_CHANNEL = "msedge"
npm run test:browser
npx wrangler d1 migrations list killer-game --local
```

Pour exécuter le Worker complet avec des données synthétiques et un D1/R2 locaux:

```powershell
npx wrangler d1 migrations apply killer-game --local --persist-to .wrangler\smoke
npm run smoke:prepare
npx wrangler d1 execute killer-game --local --persist-to .wrangler\smoke --file=.private\smoke-seed.sql
npx wrangler dev --port 8787 --persist-to .wrangler\smoke
```

Dans un second terminal:

```powershell
npm run smoke:client
```

Le serveur local doit être arrêté après le test. Aucun identifiant réel ne figure dans le seed de smoke.

## Première mise en production Cloudflare

Ces opérations **mutent ou publient** des ressources et doivent être lancées séparément après validation:

1. Se connecter avec `npx wrangler login`.
2. Vérifier que D1 `killer-game` et le bucket R2 privé `killer-game-photos` existent.
3. Confirmer l'origine autorisée dans `ALLOWED_ORIGIN`.
4. Appliquer la migration distante avec `npx wrangler d1 migrations apply killer-game --remote`.
5. Copier `worker/event.example.json` vers `worker/event.local.json` et renseigner les données privées.
6. Générer `.private/seed.sql` avec `npm run seed`.
7. Importer ce seed avec `npx wrangler d1 execute killer-game --remote --file=.private/seed.sql`.
8. Déployer l'API avec `npx wrangler deploy`.
9. Remplacer `apiOrigin` dans `docs/config.js` par l'URL HTTPS du Worker.
10. Publier `main` depuis `/docs` dans les réglages GitHub Pages.

La même valeur PBKDF2 de 100 000 itérations est enregistrée dans le seed, utilisée pour la connexion par le Worker et renvoyée au navigateur pour le chiffrement des photos. Une reproduction sur le Worker de production reste requise avant d'ouvrir l'événement.

Le bucket R2 reste privé. Le navigateur ne reçoit aucun identifiant Cloudflare; toutes les lectures et écritures passent par le Worker authentifié.

## Comportement de l'application

1. Pierrot se connecte avec le mot de passe privé.
2. Il voit toutes les cibles et confirme chaque condition séparément.
3. Le Worker enregistre la date et l'heure UTC dans D1.
4. Pierrot peut compresser puis chiffrer une photo dans le navigateur.
5. Le Worker stocke seulement le blob chiffré dans R2.
6. Pierrot peut rouvrir la photo dans une boîte de dialogue: le navigateur récupère puis déchiffre localement.
7. Une photo fermée ou remplacée révoque son URL locale et le navigateur ne persiste ni mot de passe ni jeton dans son stockage.

`worker/event.local.json`, `.private/`, les dépendances et les artefacts Playwright sont ignorés par Git.
