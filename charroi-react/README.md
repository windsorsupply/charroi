# Charroi: React + Node

*Version française : [README.fr.md](README.fr.md)*

Freight transport and trailer rental in Québec, in French and English, with light, dark and automatic themes.

| Folder | Contents |
|---|---|
| `client/` | The **React** app (Vite), every screen. It also becomes the iPhone and Android app (Capacitor). |
| `server/` | The **Node.js** server (Express): accounts, business rules, Stripe payments, files, real time, notifications. |
| `server/migrations/` | The **PostgreSQL** database (tables, constraints, starter trailers). |
| `shared/` | Shared by both: FR/EN text, Québec towns, price calculations. |

**How money moves:** the customer pays with Stripe when accepting an offer. Charroi holds the money until delivery is
confirmed (or automatically after 48 h), then pays the carrier minus the commission. A dispute freezes the payout until an admin decides.

## 1. Run it on your computer

Only **Node.js** is needed. In development the server uses **PGlite** (built-in PostgreSQL) and **payments are simulated**.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**.

- **Admin:** create `.env` (copy of `.env.example`) with `ADMIN_EMAILS=you@example.com`, restart, then sign up with that email.
- **First setup (admin):** the app starts empty, with no placeholder data. In **Admin › Settings**, enter the trailer pickup address and hours, support contact and legal texts, then add your trailers in **Admin › Trailers**.
- **History:** every customer, carrier and admin finds their completed transports and rentals by year, with totals and CSV export. Nothing is ever deleted.
- **Password reset:** without an email server, the link is printed in the terminal.
- **Start over:** stop the server and delete `server/.data`.
- **Tests:** `npm test` runs the whole flow (load, offer, payment, delivery, rental, dispute).

## 2. Put it online on Replit

1. Import the `charroi-react` folder into Replit. The `.replit` file sets up Node.js 20 and PostgreSQL.
2. Create a PostgreSQL database in the **Database** tool. Replit sets `DATABASE_URL` for you.
3. In **Secrets**, add `JWT_SECRET` (long random string), `ADMIN_EMAILS` and `APP_URL`, plus the Stripe, storage and email keys later (see `.env.example`).
4. Click **Run**, then **Deploy**.
5. **Photos and documents:** Replit's disk isn't permanent. Before launch, set up Cloudflare R2 or AWS S3 (`S3_…` secrets).

## 3. Real payments (Stripe)

Server secret `STRIPE_SECRET_KEY`, app key `VITE_STRIPE_PUBLISHABLE_KEY` in `client/.env`, and a webhook to
`https://YOUR-APP/api/stripe/webhook` for these events:
- `payment_intent.succeeded`
- `payment_intent.canceled`
- `account.updated` (tick "connected accounts")
- `identity.verification_session.verified`
- `identity.verification_session.requires_input`

Then put the signing secret in `STRIPE_WEBHOOK_SECRET`. Simulation turns off as soon as a Stripe key is set, and is always off in production.

## 4. iPhone and Android apps

```bash
cd client
npx cap add android
node scripts/native-setup.mjs
npm run assets
npm run android
```

Before building, set `VITE_API_URL=https://YOUR-APP` in `client/.env`.
- **Push notifications:** Firebase config files in the native projects, and `FCM_SERVICE_ACCOUNT` on the server.
- **iOS:** the same commands with `ios`, on a Mac or with Codemagic.

## 5. Before submitting to the stores

- [ ] Lawyer-reviewed terms and privacy policy, pasted into Admin › Settings (Québec Law 25).
- [ ] Decision on the carrier subscription: bill outside the app, or remove it at launch.
- [ ] Durable file storage (R2/S3) and SMTP email configured.
- [ ] Demo accounts for Apple and Google reviewers.
- [ ] Live Stripe keys at launch.
