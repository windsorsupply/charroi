// Comptes : inscription, connexion, invité (sans compte), mot de passe oublié.
// Jeton JWT envoyé par l’app dans l’en-tête « Authorization: Bearer … ».
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { one } from './db.js';
import { work, fail, str, AppError } from './services/common.js';
import { EMAIL } from '../../shared/pricing.js';
import { sendMail } from './mailer.js';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

export const sign = (u) => jwt.sign({ sub: u.id }, config.jwtSecret, { expiresIn: '60d' });

// Lit le jeton (si présent) et charge l’utilisateur. Ne bloque pas les visiteurs.
export async function readUser(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (tok) {
      const p = jwt.verify(tok, config.jwtSecret);
      const u = await one('select * from users where id = $1 and not deleted', [p.sub]);
      if (u) req.user = u;
    }
  } catch (_) { /* jeton invalide ou expiré : visiteur */ }
  next();
}

// Champs du formulaire d’inscription → colonnes du profil.
function profileFields(m, email) {
  const role = m.role === 'carrier' ? 'carrier' : 'client';
  const name = `${str(m.firstName, 80)} ${str(m.lastName, 80)}`.trim();
  const tax = m.taxReg === 'yes';
  const heavy = !!m.heavy;
  const f = {
    role, name, email,
    company: role === 'carrier' ? str(m.company, 120) || name : str(m.company, 120),
    city: str(m.city, 80), region: str(m.region, 10), lang: m.lang === 'en' ? 'en' : 'fr',
    phone: str(m.phone, 30), address: str(m.address, 200), postal: str(m.postal, 10).toUpperCase(),
    kind: m.kind || null, ship_volume: m.volume || null, marketing: !!m.marketing, neq: str(m.neq, 20), status: m.status || null,
    terms_at: new Date().toISOString(),
  };
  if (role === 'carrier') Object.assign(f, {
    vehicle: str(m.vehicle, 20), capacity: Number(m.capacity) || 0, exp: parseInt(m.exp) || 0,
    regions: Array.isArray(m.regions) ? m.regions.map((x) => str(x, 10)).slice(0, 20) : [],
    veh: JSON.stringify({ make: str(m.make, 60), model: str(m.model, 60), year: str(m.year, 4), length: Number(m.length) || null, liftgate: !!m.liftgate, equip: Array.isArray(m.equip) ? m.equip.slice(0, 10) : [], plate: str(m.plate, 12).toUpperCase() }),
    tax_reg: tax, tps: tax ? str(m.tps, 30) : null, tvq: tax ? str(m.tvq, 30) : null,
    ins: JSON.stringify({ insurer: str(m.insurer, 80), policy: str(m.policy, 60), exp: m.insExp || '', cargoAmt: Math.round((Number(m.cargoAmt) || 0) * 100) }),
    lic_class: str(m.licClass, 2), nir: heavy ? str(m.nir, 20) : null,
    docs: JSON.stringify({
      license: ['pending', m.licExp || '', null],
      registration: ['pending', '', null],
      nir: heavy ? ['pending', '', null] : ['na', ''],
      liability: ['pending', m.insExp || '', null],
      cargo: ['pending', m.insExp || '', null],
      tax: tax ? ['pending', '', null] : ['na', ''],
      stripe: ['pending', '', null],
    }),
  });
  if (ADMIN_EMAILS.includes(email)) f.role = 'admin';
  return f;
}

export async function signup(currentUser, body) {
  const email = str(body.email, 200).toLowerCase();
  const password = String(body.password || '');
  if (!EMAIL.test(email)) fail('errEmail');
  if (password.length < 8) fail('errPwd');
  const exists = await one('select id from users where email = $1', [email]);
  if (exists) fail('errEmailUsed', 409);
  const f = profileFields(body.meta || {}, email);
  f.password_hash = await bcrypt.hash(password, 10);
  const cols = Object.keys(f);
  return work(async (ctx) => {
    let u;
    if (currentUser && currentUser.role === 'guest') {
      // L’invité qui crée un compte garde ses réservations.
      const set = cols.map((k, i) => `${k} = $${i + 2}`).join(', ');
      u = (await ctx.c.query(`update users set ${set} where id = $1 returning *`, [currentUser.id, ...cols.map((k) => f[k])])).rows[0];
    } else {
      u = (await ctx.c.query(`insert into users (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning *`, cols.map((k) => f[k]))).rows[0];
    }
    if (u.role === 'carrier') await ctx.notify('admin', 'nNewCarrier', { c: u.company }, '#/admin/carriers');
    return { token: sign(u), userId: u.id };
  });
}

export async function login(body) {
  const email = str(body.email, 200).toLowerCase();
  const u = await one('select * from users where email = $1 and not deleted', [email]);
  if (!u || !u.password_hash || !(await bcrypt.compare(String(body.password || ''), u.password_hash))) fail('errLogin', 401);
  return { token: sign(u) };
}

// Visiteur qui loue une remorque sans compte : profil « invité ».
export async function guest() {
  const u = await one("insert into users (role) values ('guest') returning id");
  return { token: sign(u) };
}

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function forgot(body) {
  const email = str(body.email, 200).toLowerCase();
  const u = await one('select id, lang from users where email = $1 and not deleted', [email]);
  // Même réponse que le compte existe ou non (ne révèle pas les adresses inscrites).
  if (!u) return { ok: true };
  const token = crypto.randomBytes(32).toString('hex');
  await work((ctx) => ctx.c.query("insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')", [hash(token), u.id]));
  const link = `${config.appUrl}/#/reset?token=${token}`;
  await sendMail(email, u.lang, 'reset', { link });
  return { ok: true };
}

export async function reset(body) {
  const token = String(body.token || '');
  const password = String(body.password || '');
  if (password.length < 8) fail('errPwd');
  const r = await one('select user_id from password_resets where token_hash = $1 and expires_at > now()', [hash(token)]);
  if (!r) throw new AppError('resetExpired', 400);
  const ph = await bcrypt.hash(password, 10);
  await work(async (ctx) => {
    await ctx.c.query('update users set password_hash = $2 where id = $1', [r.user_id, ph]);
    await ctx.c.query('delete from password_resets where user_id = $1', [r.user_id]);
  });
  return { ok: true };
}
