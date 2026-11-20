# Décisions techniques

## Overview

Cette référence résume les décisions confirmées du jeu Mission Pierrot. Elle permet aux contributeurs de comprendre l'architecture sans publier les enregistrements internes des sessions de travail.

Le projet reste volontairement simple: un événement court, un seul utilisateur authentifié et aucun système de comptes multi-joueurs.

## Supported scenarios

Cette architecture couvre:

- une interface mobile servie par GitHub Pages;
- une seule session protégée par mot de passe pour le killer;
- une liste complète de cibles accessible uniquement au killer;
- l'enregistrement indépendant de chaque victoire avec date et heure;
- le stockage d'une photo chiffrée pour chaque victoire.

Elle ne couvre pas les notifications, les parties multi-événements, la gestion de comptes, le temps réel ni l'administration en libre-service.

## Inputs

### Source de vérité

| Élément | Source de vérité | Publication |
|---------|------------------|-------------|
| Code frontend | `docs/` | Public |
| API et règles serveur | `worker/src/index.js` | Public |
| Schéma de données | `worker/migrations/0001_initial.sql` | Public |
| Exemple de configuration d'événement | `worker/event.example.json` | Public |
| Noms, défis et mot de passe réels | `worker/event.local.json` | Privé et ignoré par Git |
| Seed SQL réel | `.private/seed.sql` | Privé et ignoré par Git |
| Suivi de travail RPI | Dossier interne de session | Privé et ignoré par Git |

### Identité et accès

- Le killer est le seul utilisateur qui se connecte.
- Un seul mot de passe ouvre l'événement.
- Les personnes ciblées ne disposent pas de compte ni de mot de passe.
- Une session opaque et temporaire est créée après vérification du mot de passe.
- Toutes les routes de modification exigent cette session.

### Données d'événement

Le seed local définit:

- l'identifiant de l'événement;
- le nom affiché du killer;
- le mot de passe local;
- la liste ordonnée des cibles;
- la condition d'assassinat propre à chaque cible.

Le générateur enregistre un vérificateur dérivé du mot de passe. Le mot de passe brut n'entre pas dans le seed SQL.

## Outputs

### Décisions confirmées

| Décision | Choix retenu | Raison |
|----------|--------------|--------|
| Hébergement frontend | GitHub Pages depuis `docs/` | Dépôt public, déploiement simple, absence de serveur frontend |
| Hébergement dynamique | Cloudflare Workers | Écritures d'état sans secret dans le navigateur |
| Base d'état | Cloudflare D1 | Modèle relationnel suffisant pour un événement court |
| Stockage média | Cloudflare R2 privé | Blob chiffré séparé des métadonnées D1 |
| Modèle utilisateur | Un seul killer authentifié | Les autres personnes sont uniquement des cibles |
| Mot de passe | Un mot de passe d'événement pour le killer | Réduit la configuration et correspond au besoin réel |
| Conditions de victoire | Une condition et un horodatage par cible | Permet de suivre chaque cible indépendamment |
| Photos | Chiffrement AES-GCM dans le navigateur | Aucun JPEG en clair n'est envoyé au stockage |
| Consultation des photos | Déchiffrement local dans une boîte de dialogue accessible | Conserve la protection R2 tout en permettant à Pierrot de revoir ses preuves |
| Données privées | Fichier de seed local ignoré par Git | Empêche la publication des noms, défis et mot de passe |
| Complexité | HTML, CSS et JavaScript sans framework UI | Maintien du principe KISS |

### Flux applicatif

1. Le killer saisit le mot de passe unique.
2. Le Worker vérifie le mot de passe avec PBKDF2.
3. Le Worker renvoie un jeton temporaire et la liste des cibles.
4. Le killer confirme une condition pour une cible.
5. D1 enregistre l'heure UTC de victoire.
6. Le navigateur compresse la photo sélectionnée.
7. Le navigateur la chiffre avec AES-GCM et une IV aléatoire.
8. R2 reçoit uniquement le texte chiffré; D1 conserve sa clé opaque.

### État actuel

| Partie | État |
|--------|------|
| Interface mobile et liste des cibles | Implémentée |
| Modèle D1 à killer unique | Implémenté |
| Routes de session, victoire et photo | Implémentées |
| Chiffrement photo côté navigateur | Implémenté |
| Consultation des photos chiffrées | Implémentée |
| Configuration Wrangler, migration et identifiant D1 | Implémentée |
| Seed privé local testable | Implémenté avec 100 000 itérations |
| Tests Node Worker/D1/R2 et navigateur | Implémentés |
| Déploiement Cloudflare et migration distante | À autoriser séparément |
| Validation du Worker de production | À exécuter après le premier déploiement |

## Notes and limitations

- GitHub Pages ne peut ni écrire dans D1 ni protéger une clé Cloudflare. Le navigateur communique avec le Worker; il ne reçoit aucun identifiant Cloudflare.
- Le chiffrement protège le contenu photo contre l'accès au dépôt ou au bucket, pas les métadonnées de victoire conservées par le service.
- Les noms et défis présents dans `worker/event.local.json` restent privés, mais ils doivent être considérés comme accessibles aux personnes autorisées dans D1.
- Le mot de passe reste sensible: il sert à l'accès et à la dérivation de la clé de chiffrement. Sa perte rend le déchiffrement impossible.
- Le remplaçage d'une photo met à jour D1 seulement après acceptation par R2; il n'existe pas de transaction atomique inter-services.
- Le `database_id` de D1 est configuré dans `wrangler.jsonc`; seule l'URL finale du Worker reste à renseigner dans `docs/config.js` après le déploiement.
- Les validations locales couvrent le code, les doubles D1/R2, le chiffrement Web Crypto, le Worker local et le navigateur Edge. Elles ne prouvent pas le comportement du Worker public avant son déploiement.
- Le premier accès à une photo utilise un GET binaire authentifié; la réponse Worker demande `Cache-Control: private, no-store`.

## Publication policy

Ne pas rendre le dossier interne de session public. Cette documentation est la synthèse volontairement limitée des décisions utiles aux collaborateurs. Les enregistrements internes peuvent contenir:

- des hypothèses déjà remplacées;
- des identifiants de session;
- des chemins locaux;
- des retours de revue internes;
- des noms ou paramètres propres à l'événement.

Quand une décision change, mettre à jour cette page et les contrôles associés plutôt que de copier un nouvel extrait du suivi RPI.

---

Cette synthèse a été préparée avec une assistance Copilot et doit être relue par un mainteneur avant toute utilisation comme source de décision officielle.
