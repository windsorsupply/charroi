// Outils communs aux services : erreurs, transaction avec actions « après validation »,
// notifications (base + temps réel + push), paramètres de la plateforme.
import { tx, one } from '../db.js';
import { DEFAULT_SETTINGS } from '../../../shared/pricing.js';

// Erreur métier : le code est traduit côté app (ex. « LOAD_CLOSED »).
export class AppError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const fail = (code, status) => { throw new AppError(code, status); };

// Branché par index.js (Socket.IO) et push.js, pour éviter les dépendances circulaires.
export const hooks = { emit: () => {}, push: () => {} };

// Exécute fn dans une transaction. ctx.notify / ctx.touch n’agissent qu’après la validation.
export async function work(fn) {
  const after = [], touched = new Set(), pushes = [];
  const run = async (c) => {
    const ctx = {
      c,
      after: (f) => after.push(f),
      // Signale aux personnes concernées que leurs données ont changé (rafraîchissement en direct).
      touch: (...ids) => ids.flat().filter(Boolean).forEach((x) => touched.add(String(x))),
      async notify(to, key, vars = {}, link = null) {
        const n = await c.query('insert into notifications (to_id, key, vars, link) values ($1,$2,$3,$4) returning id', [String(to), key, JSON.stringify(vars), link]);
        touched.add(String(to));
        pushes.push(n.rows[0].id);
      },
    };
    return fn(ctx);
  };
  const r = await tx(run);
  if (touched.size) hooks.emit([...touched]);
  for (const id of pushes) Promise.resolve(hooks.push(id)).catch((e) => console.error('push', e.message));
  for (const f of after) { try { await f(); } catch (e) { console.error('after', e); } }
  return r;
}

let cache = null, cacheAt = 0;
export async function settings(c) {
  if (cache && Date.now() - cacheAt < 30e3 && !c) return cache;
  const row = c ? (await c.query('select data from settings where id = 1')).rows[0] : await one('select data from settings where id = 1');
  cache = { ...DEFAULT_SETTINGS, ...(row ? row.data : {}) };
  cacheAt = Date.now();
  return cache;
}
export const clearSettingsCache = () => { cache = null; };

export async function ensureSettings() {
  const row = await one('select data from settings where id = 1');
  if (!row) await tx((c) => c.query('insert into settings (id, data) values (1, $1)', [JSON.stringify(DEFAULT_SETTINGS)]));
}

// Ajoute une étape à l’historique d’une livraison.
export const hist = (h, s) => JSON.stringify([...(h || []), [s, new Date().toISOString()]]);

export async function routeStr(c, cargoId) {
  const r = (await c.query('select from_city, to_city from cargos where id = $1', [cargoId])).rows[0];
  return r ? `${r.from_city} → ${r.to_city}` : cargoId;
}

// Identifiant « logique » : les admins partagent l’identité 'admin' (messages, notifications).
export const meKey = (u) => (u.role === 'admin' ? 'admin' : u.id);

export function need(u, ...roles) {
  if (!u) fail('AUTH_REQUIRED', 401);
  if (roles.length && !roles.includes(u.role)) fail(roles.includes('admin') && roles.length === 1 ? 'ADMIN_ONLY' : 'NOT_ALLOWED', 403);
  return u;
}

export const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
export const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
export const today = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
