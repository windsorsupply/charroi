// Place de marché : cargaisons, offres, livraison, litiges, évaluations, messagerie, profil.
// Chaque fonction reçoit l’utilisateur connecté et les données envoyées par l’app,
// vérifie les droits et les règles, puis écrit dans une transaction.
import { work, fail, need, hist, routeStr, meKey, str, int, today, isDate } from './common.js';
import { ownRefs } from '../storage.js';
import { POSTAL, VEH, GOODS, SPECIAL } from '../../../shared/pricing.js';
import { city } from '../../../shared/geo.js';

const OPEN = ['PUBLISHED', 'OFFERS_RECEIVED'];

async function recountOffers(c, cargoId) {
  const n = (await c.query("select count(*)::int n from offers where cargo_id = $1 and status = 'PENDING'", [cargoId])).rows[0].n;
  await c.query(`update cargos set offers_pending = $2,
    status = case when status in ('PUBLISHED','OFFERS_RECEIVED') then (case when $2 > 0 then 'OFFERS_RECEIVED' else 'PUBLISHED' end) else status end
    where id = $1`, [cargoId, n]);
}

// ---------- Cargaisons ----------
export async function publishCargo(u, { c }) {
  need(u, 'client');
  c = c || {};
  const F = c.from || {}, T = c.to || {}, g = c.goods || {}, tr = c.transport || {};
  if (!city(F.city) || !city(T.city)) fail('errCity');
  if (!isDate(F.date) || !isDate(T.date) || F.date < today() || T.date < F.date) fail('BAD_DATES');
  if (!str(F.address) || !str(T.address)) fail('BAD_INPUT');
  if ((F.postal && !POSTAL.test(F.postal)) || (T.postal && !POSTAL.test(T.postal))) fail('errPostal');
  if (!str(g.desc) || !(Number(g.weight) > 0)) fail('BAD_GOODS');
  const pkgs = (Array.isArray(g.pkgs) ? g.pkgs : []).slice(0, 3).map((p) => ({ l: Number(p.l) || 0, w: Number(p.w) || 0, h: Number(p.h) || 0 }));
  if (!pkgs.length || pkgs.some((p) => !(p.l > 0 && p.w > 0 && p.h > 0))) fail('BAD_GOODS');
  const vehicle = VEH.includes(tr.vehicle) ? tr.vehicle : 'standard';
  return work(async (ctx) => {
    const photos = await ownRefs(ctx.c, u, (g.photos || []).slice(0, 8));
    const goods = {
      type: GOODS.includes(g.type) ? g.type : 'other', desc: str(g.desc, 1000), pkgs, count: Math.max(pkgs.length, int(g.count)),
      weight: Number(g.weight), unit: ['in', 'ft', 'cm'].includes(g.unit) ? g.unit : 'in', value: Math.max(0, int(g.value)),
      fragile: !!g.fragile, notes: str(g.notes, 1000), photos,
    };
    const transport = { vehicle, trailer: 'none', capacity: Number(tr.capacity) || goods.weight, loading: !!tr.loading, unloading: !!tr.unloading };
    const row = (await ctx.c.query(`insert into cargos (client_id, from_city, from_date, from_time, from_address, from_postal, from_notes,
        to_city, to_date, to_time, to_address, to_postal, to_notes, goods, transport, special, budget, km)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`, [
      u.id, city(F.city)[0], F.date, str(F.time, 5), str(F.address, 200), str(F.postal, 7).toUpperCase(), str(F.notes, 500),
      city(T.city)[0], T.date, str(T.time, 5), str(T.address, 200), str(T.postal, 7).toUpperCase(), str(T.notes, 500),
      JSON.stringify(goods), JSON.stringify(transport), SPECIAL.includes(vehicle), c.budget ? Math.max(1, int(c.budget)) : null, int(c.km),
    ])).rows[0];
    const r = `${city(F.city)[0]} → ${city(T.city)[0]}`;
    const carriers = (await ctx.c.query("select id from users where role = 'carrier' and verified and not deleted")).rows;
    for (const x of carriers) await ctx.notify(x.id, 'nNewLoad', { r }, `#/cargo/${row.id}`);
    ctx.touch('all');
    return row.id;
  });
}

export async function setCargoPhotos(u, { cargoId, photos }) {
  need(u, 'client');
  return work(async (ctx) => {
    const refs = await ownRefs(ctx.c, u, (photos || []).slice(0, 8));
    const r = await ctx.c.query(`update cargos set goods = jsonb_set(goods, '{photos}', $3::jsonb)
      where id = $1 and client_id = $2 and status in ('PUBLISHED','OFFERS_RECEIVED','TRANSPORTER_SELECTED') returning id`, [cargoId, u.id, JSON.stringify(refs)]);
    if (!r.rows.length) fail('NOT_ALLOWED', 403);
    ctx.touch('all');
  });
}

export async function cancelCargo(u, { cargoId }) {
  need(u, 'client');
  return work(async (ctx) => {
    const r = await ctx.c.query(`update cargos set status = 'CANCELLED' where id = $1 and client_id = $2 and status = any($3)
      and not exists (select 1 from deliveries d where d.cargo_id = $1 and d.status <> 'CANCELLED') returning id`, [cargoId, u.id, OPEN]);
    if (!r.rows.length) fail('NOT_ALLOWED', 403);
    const rej = (await ctx.c.query("update offers set status = 'REJECTED' where cargo_id = $1 and status = 'PENDING' returning carrier_id", [cargoId])).rows;
    const route = await routeStr(ctx.c, cargoId);
    for (const o of rej) await ctx.notify(o.carrier_id, 'nOfferRejected', { r: route }, `#/cargo/${cargoId}`);
    await recountOffers(ctx.c, cargoId);
    ctx.touch('all');
  });
}

// ---------- Offres ----------
export async function submitOffer(u, { cargoId, price, avail, hours, comment, vehicle }) {
  need(u, 'carrier');
  if (!u.verified) fail('NOT_VERIFIED');
  price = int(price);
  if (price <= 0 || price > 10000000) fail('BAD_PRICE');
  if (!isDate(avail) || avail < today()) fail('BAD_DATE');
  return work(async (ctx) => {
    const c = (await ctx.c.query('select * from cargos where id = $1 for update', [cargoId])).rows[0];
    if (!c) fail('NOT_FOUND', 404);
    if (!OPEN.includes(c.status)) fail('LOAD_CLOSED');
    const dup = (await ctx.c.query("select 1 from offers where cargo_id = $1 and carrier_id = $2 and status in ('PENDING','ACCEPTED')", [cargoId, u.id])).rows;
    if (dup.length) fail('ALREADY_OFFERED');
    const o = (await ctx.c.query(`insert into offers (cargo_id, carrier_id, price, avail_date, hours, comment, vehicle, trailer)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [cargoId, u.id, price, avail, Math.max(0.5, Number(hours) || 1), str(comment, 1000),
      VEH.includes(vehicle) ? vehicle : 'standard', u.trailer || 'none'])).rows[0];
    await recountOffers(ctx.c, cargoId);
    await ctx.notify(c.client_id, 'nNewOffer', { c: u.company, p: price, r: `${c.from_city} → ${c.to_city}` }, `#/cargo/${cargoId}`);
    ctx.touch('all', u.id);
    return o.id;
  });
}

export async function withdrawOffer(u, { offerId }) {
  need(u, 'carrier');
  return work(async (ctx) => {
    const r = (await ctx.c.query("update offers set status = 'WITHDRAWN' where id = $1 and carrier_id = $2 and status = 'PENDING' returning cargo_id", [offerId, u.id])).rows[0];
    if (!r) fail('NOT_ALLOWED', 403);
    await recountOffers(ctx.c, r.cargo_id);
    const owner = (await ctx.c.query('select client_id from cargos where id = $1', [r.cargo_id])).rows[0];
    ctx.touch('all', u.id, owner.client_id);
  });
}

// ---------- Livraison ----------
async function lockDelivery(c, id) {
  const d = (await c.query('select * from deliveries where id = $1 for update', [id])).rows[0];
  if (!d) fail('NOT_FOUND', 404);
  return d;
}

export async function advanceDelivery(u, { deliveryId, status }) {
  need(u, 'carrier');
  return work(async (ctx) => {
    const d = await lockDelivery(ctx.c, deliveryId);
    if (d.carrier_id !== u.id) fail('NOT_ALLOWED', 403);
    const ok = (d.status === 'SCHEDULED' && status === 'PICKED_UP') || (d.status === 'PICKED_UP' && status === 'IN_TRANSIT');
    if (!ok) fail('BAD_TRANSITION');
    await ctx.c.query('update deliveries set status = $2, history = $3 where id = $1', [d.id, status, hist(d.history, status)]);
    await ctx.notify(d.client_id, status === 'PICKED_UP' ? 'nPickedUp' : 'nInTransit', { r: await routeStr(ctx.c, d.cargo_id) }, `#/delivery/${d.id}`);
    ctx.touch(d.client_id, d.carrier_id, 'admin');
  });
}

export async function submitProof(u, { deliveryId, proof }) {
  need(u, 'carrier');
  proof = proof || {};
  if (!str(proof.recipient)) fail('RECIPIENT_REQUIRED');
  return work(async (ctx) => {
    const d = await lockDelivery(ctx.c, deliveryId);
    if (d.carrier_id !== u.id || d.status !== 'IN_TRANSIT') fail('NOT_ALLOWED', 403);
    const [photo] = await ownRefs(ctx.c, u, [proof.photo], { priv: true });
    const [sig] = await ownRefs(ctx.c, u, [proof.sig], { priv: true });
    if (!photo && !sig) fail('errSig');
    const p = { recipient: str(proof.recipient, 120), comment: str(proof.comment, 1000), photo: photo || null, sig: sig || null, geo: proof.geo ? str(proof.geo, 40) : null, at: new Date().toISOString() };
    await ctx.c.query("update deliveries set status = 'DELIVERED', delivered_at = now(), history = $2, proof = $3 where id = $1", [d.id, hist(d.history, 'DELIVERED'), JSON.stringify(p)]);
    await ctx.notify(d.client_id, 'nDelivered', { r: await routeStr(ctx.c, d.cargo_id) }, `#/delivery/${d.id}`);
    ctx.touch(d.client_id, d.carrier_id, 'admin');
  });
}

export async function openDispute(u, { deliveryId, reason, desc, photos }) {
  need(u, 'client');
  if (!['damaged', 'missing', 'late', 'notdelivered', 'other'].includes(reason) || !str(desc)) fail('BAD_INPUT');
  return work(async (ctx) => {
    const d = await lockDelivery(ctx.c, deliveryId);
    if (d.client_id !== u.id || d.status !== 'DELIVERED') fail('NOT_ALLOWED', 403);
    const refs = await ownRefs(ctx.c, u, (photos || []).slice(0, 4), { priv: true });
    const x = (await ctx.c.query('insert into disputes (delivery_id, reason, descr, photos) values ($1,$2,$3,$4) returning id', [d.id, reason, str(desc, 4000), refs])).rows[0];
    await ctx.c.query("update deliveries set status = 'DISPUTED', history = $2 where id = $1", [d.id, hist(d.history, 'DISPUTED')]);
    await ctx.notify('admin', 'nDispute', { r: d.id }, `#/delivery/${d.id}`);
    await ctx.notify(d.carrier_id, 'nDispute', { r: d.id }, `#/delivery/${d.id}`);
    ctx.touch(d.client_id, d.carrier_id, 'admin');
    return x.id;
  });
}

// ---------- Évaluations ----------
export async function sendReview(u, { kind, refId, stars, text }) {
  need(u);
  stars = int(stars);
  if (stars < 1 || stars > 5) fail('rPick');
  return work(async (ctx) => {
    let to;
    if (kind === 'delivery') {
      const d = (await ctx.c.query('select * from deliveries where id = $1', [refId])).rows[0];
      if (!d || d.status !== 'COMPLETED' || ![d.client_id, d.carrier_id].includes(u.id)) fail('NOT_ALLOWED', 403);
      to = u.id === d.client_id ? d.carrier_id : d.client_id;
    } else if (kind === 'rental') {
      const b = (await ctx.c.query('select * from bookings where id = $1', [refId])).rows[0];
      if (!b || b.status !== 'COMPLETED' || b.client_id !== u.id) fail('NOT_ALLOWED', 403);
      to = 'admin';
    } else fail('BAD_INPUT');
    const exists = (await ctx.c.query('select 1 from reviews where ref_id = $1 and from_id = $2', [refId, u.id])).rows.length;
    if (exists) fail('rDone');
    await ctx.c.query('insert into reviews (kind, ref_id, from_id, from_name, to_id, stars, text) values ($1,$2,$3,$4,$5,$6,$7)', [kind, refId, u.id, u.name, String(to), stars, str(text, 2000)]);
    await ctx.c.query("update users set rating_sum = rating_sum + $2, rating_n = rating_n + 1 where id::text = $1 and role = 'carrier'", [String(to), stars]);
    ctx.touch('all');
  });
}

// ---------- Messagerie ----------
// Masque courriels et numéros de téléphone avant qu’un transporteur soit choisi.
export const maskContact = (t) => String(t)
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '•••')
  .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '•••');

export async function preChat(u, { cargoId, carrierId }) {
  need(u);
  return work(async (ctx) => {
    const c = (await ctx.c.query('select * from cargos where id = $1', [cargoId])).rows[0];
    if (!c || !c.special) fail('NOT_ALLOWED', 403);
    if (u.id !== c.client_id && u.id !== carrierId) fail('NOT_ALLOWED', 403);
    const cr = (await ctx.c.query("select 1 from users where id = $1 and role = 'carrier' and verified", [carrierId])).rows;
    if (!cr.length) fail('NOT_ALLOWED', 403);
    let cv = (await ctx.c.query("select id from convs where kind = 'pre' and ref_id = $1 and $2 = any(members)", [cargoId, carrierId])).rows[0];
    if (!cv) cv = (await ctx.c.query("insert into convs (kind, ref_id, members) values ('pre', $1, $2) returning id", [cargoId, [c.client_id, carrierId]])).rows[0];
    ctx.touch(c.client_id, carrierId);
    return cv.id;
  });
}

export async function sendMessage(u, { convId, text }) {
  need(u);
  let txt = str(text, 4000);
  if (!txt) return null;
  const me = meKey(u);
  return work(async (ctx) => {
    const cv = (await ctx.c.query('select * from convs where id = $1 for update', [convId])).rows[0];
    if (!cv || !(cv.members.includes(me) || me === 'admin')) fail('NOT_ALLOWED', 403);
    if (cv.kind === 'pre') txt = maskContact(txt);
    await ctx.c.query('insert into messages (conv_id, from_id, text) values ($1,$2,$3)', [convId, me, txt]);
    await ctx.c.query('update convs set seen = $2, last_at = now() where id = $1', [convId, JSON.stringify({ [me]: true })]);
    for (const m of cv.members) if (m !== me) await ctx.notify(m, 'nMsg', { r: cv.ref_id }, `#/chat/${convId}`);
    ctx.touch(cv.members, 'admin');
  });
}

export async function markSeen(u, { convId }) {
  need(u);
  const me = meKey(u);
  await work((ctx) => ctx.c.query("update convs set seen = seen || $2::jsonb where id = $1 and ($3 = any(members) or $3 = 'admin')", [convId, JSON.stringify({ [me]: true }), me]));
}

export async function readNotifs(u, { id }) {
  need(u);
  await work((ctx) => ctx.c.query('update notifications set read = true where (to_id = $1 or to_id = $2) and ($3::bigint is null or id = $3) and not read',
    [u.id, meKey(u), id == null ? null : Number(id)]));
}

// ---------- Profil ----------
export async function updateProfile(u, p) {
  need(u);
  p = p || {};
  await work(async (ctx) => {
    if (p.lang && ['fr', 'en'].includes(p.lang)) await ctx.c.query('update users set lang = $2 where id = $1', [u.id, p.lang]);
    if (p.phone != null) await ctx.c.query('update users set phone = $2 where id = $1', [u.id, str(p.phone, 30)]);
    if (p.desc != null) await ctx.c.query('update users set descr = $2 where id = $1', [u.id, JSON.stringify(str(p.desc, 1000))]);
  });
}

// Photos envoyées juste après l’inscription (profil, véhicule, documents).
export async function setSignupPhotos(u, p) {
  need(u);
  p = p || {};
  await work(async (ctx) => {
    const [photo] = await ownRefs(ctx.c, u, [p.photo]);
    const [vehPhoto] = await ownRefs(ctx.c, u, [p.vehPhoto]);
    const [reg] = await ownRefs(ctx.c, u, [p.regPhoto], { priv: true });
    const [ins] = await ownRefs(ctx.c, u, [p.insPhoto], { priv: true });
    const cur = (await ctx.c.query('select docs, veh from users where id = $1', [u.id])).rows[0];
    const docs = cur.docs || {};
    if (reg && docs.registration) docs.registration[2] = reg;
    if (ins && docs.liability) docs.liability[2] = ins;
    const veh = cur.veh ? { ...cur.veh, photo: vehPhoto || cur.veh.photo || null } : null;
    await ctx.c.query('update users set photo = coalesce($2, photo), veh = $3, docs = $4 where id = $1', [u.id, photo || null, veh ? JSON.stringify(veh) : null, JSON.stringify(docs)]);
    ctx.touch('admin');
  });
}

// Le transporteur remplace un document : il redevient « à vérifier ».
export async function setDoc(u, { key, photo, exp }) {
  need(u, 'carrier');
  if (!['license', 'registration', 'nir', 'liability', 'cargo', 'tax'].includes(key)) fail('BAD_INPUT');
  await work(async (ctx) => {
    const [ref] = await ownRefs(ctx.c, u, [photo], { priv: true });
    if (!ref) fail('BAD_FILE');
    const docs = (await ctx.c.query('select docs from users where id = $1', [u.id])).rows[0].docs || {};
    docs[key] = ['pending', exp || (docs[key] && docs[key][1]) || '', ref];
    await ctx.c.query('update users set docs = $2, verified = false, rejected = false where id = $1', [u.id, JSON.stringify(docs)]);
    await ctx.notify('admin', 'nNewCarrier', { c: u.company }, '#/admin/carriers');
    ctx.touch('all');
  });
}
