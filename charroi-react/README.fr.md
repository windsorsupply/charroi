# Charroi : React + Node

*English version: [README.md](README.md)*

Transport de marchandises et location de remorques au Québec, en français et en anglais.

| Dossier | Contenu |
|---|---|
| `client/` | L’app **React** (Vite) : tous les écrans. Devient aussi l’app iPhone et Android (Capacitor). |
| `server/` | Le serveur **Node.js** (Express) : comptes, règles métier, paiements Stripe, fichiers, temps réel, notifications. |
| `server/migrations/` | La base **PostgreSQL** (tables, contraintes, remorques de départ). |
| `shared/` | Ce qui est commun aux deux : textes FR/EN, villes du Québec, calcul des prix. |

**Fonctionnement de l’argent :** le client paie par Stripe en acceptant une offre. Charroi garde l’argent jusqu’à la
confirmation de la livraison (ou automatiquement après 48 h), puis le verse au transporteur moins la commission.
Un litige bloque le versement jusqu’à la décision d’un admin.

---

## 1. Lancer l’app sur votre ordinateur

Il faut seulement **Node.js** (déjà installé). Aucune base de données à installer : en développement, le serveur
utilise **PGlite**, un PostgreSQL intégré, et les **paiements sont simulés** (aucun argent réel).

```bash
cd "Documents/Charroi html code/charroi-react"
npm install
npm run dev
```

Ouvrez **http://localhost:5173**. Un bandeau orange rappelle que les paiements sont simulés.

- **Devenir administrateur :** créez le fichier `.env` (copie de `.env.example`) avec `ADMIN_EMAILS=votre@courriel.ca`,
  relancez `npm run dev`, puis créez votre compte avec ce courriel.
- **Premiers réglages (admin) :** l’app démarre vide, sans données fictives. Dans **Administration › Paramètres**, entrez l’adresse et les heures de prise en charge des remorques, vos coordonnées de soutien et vos textes légaux. Puis ajoutez vos remorques dans **Administration › Remorques**.
- **Historique :** chaque client, transporteur et admin retrouve ses transports et locations terminés, classés par année, avec totaux et export CSV (menu « Historique », tableau de bord ou profil). Rien n’est jamais effacé.
- **Mot de passe oublié :** sans serveur de courriel, le lien s’affiche dans le terminal.
- **Repartir de zéro :** arrêtez le serveur et supprimez le dossier `server/.data`.
- **Tests automatiques :** `npm test` joue tout le parcours (cargaison, offre, paiement, livraison, location, litige).

## 2. Mettre l’app en ligne sur Replit

1. Sur replit.com : **Create App → Import from…** et importez le dossier `charroi-react`, ou glissez-y ses fichiers.
   Le fichier `.replit` configure tout : Node.js 20 et PostgreSQL.
2. Ouvrez l’outil **Database** et créez une base PostgreSQL. Replit remplit `DATABASE_URL` tout seul.
3. Dans **Secrets**, ajoutez :
   - `JWT_SECRET` : une longue phrase au hasard ;
   - `ADMIN_EMAILS` : votre courriel ;
   - `APP_URL` : l’adresse de votre app une fois publiée (ex. `https://charroi.replit.app`) ;
   - plus tard, les clés Stripe, de stockage et de courriel (voir `.env.example`).
4. Cliquez sur **Run** pour essayer, puis sur **Deploy** pour publier.
5. **Photos et documents :** sur Replit, le disque n’est pas permanent. Avant de lancer pour vrai, créez un espace
   **Cloudflare R2** (ou AWS S3) et ajoutez les secrets `S3_…`.

Les tables sont créées automatiquement au premier démarrage.

## 3. Brancher les vrais paiements (Stripe)

1. Dans Stripe (compte au Canada) : activez **Connect** (comptes Express) et **Identity**.
2. Secrets du serveur : `STRIPE_SECRET_KEY` (commence par `sk_`).
3. App : fichier `client/.env` avec `VITE_STRIPE_PUBLISHABLE_KEY` (commence par `pk_`), puis recompilez.
4. Stripe → Developers → **Webhooks** → adresse `https://VOTRE-APP/api/stripe/webhook`, avec les événements
   `payment_intent.succeeded`, `payment_intent.canceled`, `account.updated`,
   `identity.verification_session.verified` et `identity.verification_session.requires_input`.
   Cochez aussi les événements des comptes connectés. Copiez le secret de signature dans `STRIPE_WEBHOOK_SECRET`.
5. Testez avec la carte `4242 4242 4242 4242`, puis passez aux clés réelles au lancement.

Dès qu’une clé Stripe est présente, la simulation est désactivée. Elle l’est aussi toujours en production.

## 4. Les apps iPhone et Android

Tout se passe dans le dossier `client` :

```bash
cd client
npx cap add android
node scripts/native-setup.mjs
npm run assets
npm run android
```

- Avant de compiler, mettez dans `client/.env` : `VITE_API_URL=https://VOTRE-APP` (l’adresse du serveur en ligne).
- Sur le serveur, ajoutez le secret `CORS_ORIGINS` si nécessaire (les origines Capacitor sont déjà autorisées).
- Notifications push : `google-services.json` (Android) et `GoogleService-Info.plist` (iOS) de Firebase, et le secret
  `FCM_SERVICE_ACCOUNT` sur le serveur.
- iOS : mêmes commandes avec `ios` à la place de `android`, sur un Mac ou avec Codemagic.

## 5. Avant de publier sur les boutiques

- [ ] Conditions d’utilisation et politique de confidentialité révisées par un avocat, puis collées dans Administration › Paramètres (Loi 25 : nommer le responsable dans le même écran).
- [ ] Décision sur l’abonnement transporteur (59,99 $/mois) : facturé hors de l’app ou retiré au lancement.
- [ ] Stockage durable des fichiers (R2/S3) et serveur de courriel (SMTP) configurés.
- [ ] Comptes de démonstration pour les examinateurs d’Apple et de Google.
- [ ] Clés Stripe réelles au lancement.

Déjà dans le code : suppression du compte dans l’app, français et anglais partout, thème clair, sombre ou automatique, mots de passe chiffrés,
fichiers privés protégés par des liens temporaires, carte bancaire saisie chez Stripe (jamais sur nos serveurs).

## Pour un développeur

- **Règles « qui voit quoi » :** `server/src/state.js`. Par exemple, l’adresse exacte d’une cargaison n’est visible
  qu’après le choix du transporteur.
- **Écritures :** toutes passent par `POST /api/a/<action>` (liste dans `server/src/index.js`). Chaque action vérifie
  les droits et écrit dans une transaction (`server/src/services/`).
- **Prix :** recalculés par le serveur (`shared/pricing.js`).
- **Doubles réservations :** impossibles, la base les refuse (contrainte d’exclusion).
- **Temps réel :** Socket.IO ; après chaque changement, les personnes concernées rechargent leurs données.
