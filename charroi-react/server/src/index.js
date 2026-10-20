// Serveur Charroi : API (Express), temps réel (Socket.IO), fichiers, webhook Stripe,
// tâches planifiées, et l’app web React (client/dist) une fois compilée.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { config, ROOT, isProd } from './config.js';
import { connect, one, query } from './db.js';
import { hooks, ensureSettings, need, work, AppError } from './services/common.js';
import { readUser, signup, login, guest, forgot, reset } from './auth.js';
import { buildState } from './state.js';
import { save, read, checkSig } from './storage.js';
import { sendPush } from './push.js';
import * as market from './services/market.js';
import * as admin from './services/admin.js';
import * as pay from './services/payments.js';
import { history } from './services/history.js';

await connect();
await ensureSettings();

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origin === config.appUrl || config.corsOrigins.includes(origin)),
}));

// Webhook Stripe : corps brut nécessaire pour vérifier la signature (avant express.json).
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try { res.json(await pay.handleWebhook(req.body, req.headers['stripe-signature'])); }
  catch (e) { console.error('webhook', e.message); res.status(400).send(`Webhook error: ${e.message}`); }
});

app.use(express.json({ limit: '8mb' }));
app.use(readUser);

const wrap = (fn) => async (req, res) => {
  try { res.json((await fn(req)) ?? { ok: true }); }
  catch (e) {
    if (e instanceof AppError) return res.status(e.status).json({ error: e.code });
    if (e.type && String(e.type).startsWith('Stripe')) { console.error('stripe', e.message); return res.status(402).json({ error: e.message }); }
    console.error(e);
    res.status(500).json({ error: isProd ? 'SERVER_ERROR' : e.message });
  }
};

// ---------- Comptes ----------
const authLimit = rateLimit({ windowMs: 15 * 60e3, limit: 30, standardHeaders: true, legacyHeaders: false });
app.post('/api/auth/signup', authLimit, wrap((req) => signup(req.user, req.body)));
app.post('/api/auth/login', authLimit, wrap((req) => login(req.body)));
app.post('/api/auth/guest', authLimit, wrap(() => guest()));
app.post('/api/auth/forgot', authLimit, wrap((req) => forgot(req.body)));
app.post('/api/auth/reset', authLimit, wrap((req) => reset(req.body)));

// ---------- Données visibles par la personne ----------
app.get('/api/state', wrap(async (req) => ({ ...(await buildState(req.user)), devSim: pay.SIM })));
app.get('/api/health', (_req, res) => res.json({ ok: true, simulatedPayments: pay.SIM }));

// ---------- Fichiers ----------
app.post('/api/upload', rateLimit({ windowMs: 60e3, limit: 60 }), wrap(async (req) => {
  const u = need(req.user);
  return { ref: await work((ctx) => save(ctx.c, u, req.body.data, { priv: !!req.body.priv, docs: !!req.body.docs })) };
}));
const sendFile = async (res, id) => {
  const buf = await read(id);
  if (!buf) return res.status(404).end();
  res.type(id.split('.').pop()).set('Cache-Control', 'private, max-age=3600').send(buf);
};
app.get('/files/pub/:id', async (req, res) => {
  const f = await one('select private from files where id = $1', [req.params.id]);
  if (!f || f.private) return res.status(404).end();
  sendFile(res, req.params.id);
});
app.get('/files/priv/:id', (req, res) => {
  if (!checkSig(req.params.id, req.query.e, req.query.s)) return res.status(403).end();
  sendFile(res, req.params.id);
});

// ---------- Notifications push : jeton de l’appareil ----------
app.post('/api/push-token', wrap(async (req) => {
  const u = need(req.user);
  if (!req.body.token) return { ok: false };
  if (req.body.remove) await query('delete from push_tokens where token = $1', [req.body.token]);
  else await query(`insert into push_tokens (token, user_id, platform) values ($1, $2, $3)
    on conflict (token) do update set user_id = excluded.user_id, updated_at = now()`, [String(req.body.token), u.id, String(req.body.platform || 'web')]);
  return { ok: true };
}));

// ---------- Actions de l’app ----------
const ACTIONS = {
  // place de marché
  publishCargo: market.publishCargo, setCargoPhotos: market.setCargoPhotos, cancelCargo: market.cancelCargo,
  submitOffer: market.submitOffer, withdrawOffer: market.withdrawOffer,
  advanceDelivery: market.advanceDelivery, submitProof: market.submitProof, openDispute: market.openDispute,
  sendReview: market.sendReview, preChat: market.preChat, sendMessage: market.sendMessage, markSeen: market.markSeen,
  readNotifs: market.readNotifs, updateProfile: market.updateProfile, setSignupPhotos: market.setSignupPhotos, setDoc: market.setDoc,
  // administration
  verifyCarrier: admin.verifyCarrier, saveSettings: admin.saveSettings, saveTrailer: admin.saveTrailer,
  setTrailerStatus: admin.setTrailerStatus, sendReminder: admin.sendReminder, inspBefore: admin.inspBefore,
  // historique (transports et locations passés, par année)
  history,
  // paiements
  transportIntent: pay.transportIntent, rentalIntent: pay.rentalIntent, simulatePay: pay.simulatePay, paymentStatus: pay.paymentStatus,
  confirmDelivery: pay.confirmDelivery, resolveDispute: pay.resolveDispute, cancelBooking: pay.cancelBooking,
  inspectionAfter: pay.inspectionAfter, connectOnboard: pay.connectOnboard, connectStatus: pay.connectStatus,
  identity: pay.identity, identityStatus: pay.identityStatus, deleteAccount: pay.deleteAccount,
};
app.post('/api/a/:action', rateLimit({ windowMs: 60e3, limit: 120 }), wrap((req) => {
  const fn = ACTIONS[req.params.action];
  if (!fn) throw new AppError('UNKNOWN_ACTION', 404);
  return fn(req.user, req.body || {});
}));

// ---------- Retour de Stripe vers l’app mobile (lien profond) ----------
app.get('/stripe-return', (req, res) => {
  const r = String(req.query.r || '').replace(/[^a-z-]/gi, '');
  res.redirect(302, `charroi://stripe-return?r=${r}`);
});

// ---------- App web React ----------
const dist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|files\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('API Charroi en marche. Lancez « npm run dev » pour l’app (http://localhost:5173), ou « npm run build » pour la servir ici.'));
}

// ---------- Temps réel ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: (o, cb) => cb(null, !o || o === config.appUrl || config.corsOrigins.includes(o)) } });
io.on('connection', async (socket) => {
  socket.join('all');
  try {
    const p = jwt.verify(socket.handshake.auth?.token || '', config.jwtSecret);
    const u = await one('select id, role from users where id = $1 and not deleted', [p.sub]);
    if (u) { socket.join(`u:${u.id}`); if (u.role === 'admin') socket.join('admin'); }
  } catch (_) { /* visiteur */ }
});
// Après chaque changement : les personnes concernées rechargent leurs données.
hooks.emit = (ids) => {
  if (ids.includes('all')) return io.emit('changed');
  for (const id of ids) io.to(id === 'admin' ? 'admin' : `u:${id}`).emit('changed');
};
hooks.push = sendPush;

// ---------- Tâches planifiées ----------
cron.schedule('*/5 * * * *', () => pay.expirePending().catch((e) => console.error('expire', e.message)));
cron.schedule('*/15 * * * *', () => pay.autoConfirm().catch((e) => console.error('auto-confirm', e.message)));

server.listen(config.port, () => console.log(`✓ Charroi en marche : ${config.appUrl}  (port ${config.port})`));
