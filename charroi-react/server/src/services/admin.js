// Administration : vérification des transporteurs, paramètres, remorques, inspection de départ.
import { work, fail, need, str, int, clearSettingsCache } from './common.js';
import { ownRefs } from '../storage.js';
import { TRT } from '../../../shared/pricing.js';

export async function verifyCarrier(u, { userId, ok }) {
  need(u, 'admin');
  await work(async (ctx) => {
    const c = (await ctx.c.query("select docs from users where id = $1 and role = 'carrier'", [userId])).rows[0];
    if (!c) fail('NOT_FOUND', 404);
    const docs = c.docs || {};
    // Les versements Stripe doivent être activés avant d’approuver (sinon le transporteur ne peut pas être payé).
    if (ok && (!docs.stripe || docs.stripe[0] !== 'approved')) fail('STRIPE_NOT_READY');
    for (const k of Object.keys(docs)) if (docs[k][0] === 'pending') docs[k][0] = ok ? 'approved' : 'rejected';
    await ctx.c.query('update users set docs = $2, verified = $3, rejected = $4 where id = $1', [userId, JSON.stringify(docs), !!ok, !ok]);
    if (ok) await ctx.notify(userId, 'nVerified', {}, '#/dash/docs');
    ctx.touch('all');
  });
}

export async function saveSettings(u, { p }) {
  need(u, 'admin');
  await work(async (ctx) => {
    const cur = (await ctx.c.query('select data from settings where id = 1')).rows[0].data;
    for (const k of ['commission', 'serviceFee', 'autoConfirmH', 'tps', 'tvq']) {
      const v = Number(p && p[k]);
      if (Number.isFinite(v) && v >= 0) cur[k] = v;
    }
    // Coordonnées de l’entreprise et textes légaux (affichés tels quels dans l’app).
    const TEXT = { rentalAddress: 300, rentalHours: 300, supportEmail: 200, supportPhone: 40, privacyOfficer: 300, termsFr: 50000, termsEn: 50000, privacyFr: 50000, privacyEn: 50000 };
    for (const [k, max] of Object.entries(TEXT)) if (p && typeof p[k] === 'string') cur[k] = str(p[k], max);
    await ctx.c.query('update settings set data = $1 where id = 1', [JSON.stringify(cur)]);
    ctx.touch('all');
  });
  clearSettingsCache();
}

export async function saveTrailer(u, { p }) {
  need(u, 'admin');
  p = p || {};
  if (!str(p.no) || !(int(p.day) > 0) || !TRT.includes(p.type)) fail('BAD_INPUT');
  const L2 = (v) => JSON.stringify(Array.isArray(v) ? v.slice(0, 2).map((x) => str(x, 2000)) : [str(v), str(v)]);
  return work(async (ctx) => {
    const photos = await ownRefs(ctx.c, u, (p.photos || []).slice(0, 4));
    const vals = [str(p.no, 20), L2(p.name), str(p.brand, 60), str(p.model, 60), int(p.year) || new Date().getFullYear(), p.type,
      Number(p.lf) || 0, Number(p.wf) || 0, Number(p.cap) || 0, Number(p.wt) || 0, str(p.hitch, 60), int(p.day), int(p.week) || int(p.day) * 6,
      int(p.month) || int(p.day) * 22, Math.max(0, int(p.deposit)), L2(p.desc), L2(p.cond), photos];
    let id = p.id || null;
    if (id) {
      await ctx.c.query(`update trailers set no=$2, name=$3, brand=$4, model=$5, year=$6, type=$7, lf=$8, wf=$9, cap=$10, wt=$11, hitch=$12,
        day=$13, week=$14, month=$15, deposit=$16, descr=$17, cond=$18, photos=$19 where id = $1`, [id, ...vals]);
    } else {
      id = (await ctx.c.query(`insert into trailers (no, name, brand, model, year, type, lf, wf, cap, wt, hitch, day, week, month, deposit, descr, cond, photos)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`, vals)).rows[0].id;
    }
    ctx.touch('all');
    return id;
  });
}

export async function setTrailerStatus(u, { trailerId, status }) {
  need(u, 'admin');
  if (!['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE'].includes(status)) fail('BAD_INPUT');
  await work(async (ctx) => {
    await ctx.c.query('update trailers set status = $2 where id = $1', [trailerId, status]);
    ctx.touch('all');
  });
}

export async function sendReminder(u, { bookingId }) {
  need(u, 'admin');
  await work(async (ctx) => {
    const b = (await ctx.c.query('select b.*, t.no from bookings b join trailers t on t.id = b.trailer_id where b.id = $1', [bookingId])).rows[0];
    if (!b) fail('NOT_FOUND', 404);
    await ctx.notify(b.client_id, 'nReminder', { t: b.no, d: b.end_date }, `#/booking/${bookingId}`);
  });
}

// Remise de la remorque au client, après l’inspection de départ.
export async function inspBefore(u, { bookingId, x }) {
  need(u, 'admin');
  x = x || {};
  await work(async (ctx) => {
    const photos = await ownRefs(ctx.c, u, (x.photos || []).slice(0, 4), { priv: true });
    const data = {
      state: ['good', 'fair', 'poor'].includes(x.state) ? x.state : 'good', comments: str(x.comments, 1000), existing: str(x.existing, 500),
      tires: !!x.tires, lights: !!x.lights, brakes: !!x.brakes, hitch: !!x.hitch, photos, at: new Date().toISOString(),
    };
    const r = await ctx.c.query("update bookings set status = 'ACTIVE', insp = insp || jsonb_build_object('before', $2::jsonb) where id = $1 and status = 'CONFIRMED' returning client_id", [bookingId, JSON.stringify(data)]);
    if (!r.rows.length) fail('NOT_ALLOWED', 403);
    ctx.touch(r.rows[0].client_id, 'admin', 'all');
  });
}
