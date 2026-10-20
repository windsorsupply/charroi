// Configuration lue dans les variables d’environnement (fichier .env à la racine du projet).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
dotenv.config({ path: path.join(ROOT, '.env') });

const env = process.env;
export const isProd = env.NODE_ENV === 'production';

if (isProd && !env.JWT_SECRET) throw new Error('JWT_SECRET est obligatoire en production.');
if (isProd && !env.DATABASE_URL) throw new Error('DATABASE_URL est obligatoire en production (PostgreSQL).');

export const config = {
  port: Number(env.PORT) || 3000,
  // Adresse publique de l’app (liens dans les courriels, retours de Stripe).
  // En développement, l’app est servie par Vite sur le port 5173.
  appUrl: (env.APP_URL || (isProd ? `http://localhost:${Number(env.PORT) || 3000}` : 'http://localhost:5173')).replace(/\/$/, ''),
  // Vide = PGlite (PostgreSQL intégré, pour le développement), sinon PostgreSQL réel.
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: env.PGLITE_DIR || path.join(ROOT, 'server', '.data', 'pglite'),
  jwtSecret: env.JWT_SECRET || 'dev-only-' + crypto.createHash('sha256').update(ROOT).digest('hex'),
  fileSecret: env.FILE_SECRET || env.JWT_SECRET || 'dev-files-' + ROOT,
  stripeSecret: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  // Stockage des fichiers : disque local, ou S3 / Cloudflare R2 si S3_BUCKET est fourni.
  uploadsDir: env.UPLOADS_DIR || path.join(ROOT, 'server', '.data', 'uploads'),
  s3: env.S3_BUCKET ? {
    bucket: env.S3_BUCKET, region: env.S3_REGION || 'auto', endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  } : null,
  smtp: env.SMTP_HOST ? {
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 587, secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  } : null,
  mailFrom: env.MAIL_FROM || 'Charroi <no-reply@charroi.ca>',
  fcmServiceAccount: env.FCM_SERVICE_ACCOUNT ? JSON.parse(env.FCM_SERVICE_ACCOUNT) : null,
  // Origines autorisées (app web, et apps natives Capacitor).
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
    .concat(['capacitor://localhost', 'https://localhost', 'http://localhost', 'http://localhost:5173']),
};
