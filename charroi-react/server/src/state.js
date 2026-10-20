// Construit les données visibles par la personne connectée (ou un visiteur).
// C’est ici que s’appliquent les règles « qui voit quoi » : un transporteur ne voit
// l’adresse exacte d’une cargaison qu’une fois choisi, les données personnelles ne
// sont visibles que par la personne et les admins, etc.
import { many } from './db.js';
import { settings } from './services/common.js';
import { signedUrl } from './storage.js';

const OPEN = ['PUBLISHED', 'OFFERS_RECEIVED'];

// Profil public (ce que les autres peuvent voir).
const publicUser = (p) => ({
  id: p.id, role: p.role, name: p.deleted ? '' : p.name, company: p.deleted ? '' : p.company, city: p.city, region: p.region,
  photo: p.photo, lang: p.lang, vehicle: p.vehicle, trailer: p.trailer, capacity: p.capacity, exp: p.exp,
  verified: p.verified, rejected: p.rejected, deliveries: p.deliveries, ratingSum: p.rating_sum, ratingN: p.rating_n,
  desc: p.descr || '', regions: p.regions || [], taxReg: p.tax_reg, deleted: p.deleted, createdAt: p.created_at,
  veh: p.veh ? { make: p.veh.make, model: p.veh.model, year: p.veh.year, length: p.veh.length, liftgate: p.veh.liftgate, equip: p.veh.equip, photo: p.veh.photo } : null,
  docsApproved: Object.values(p.docs || {}).filter((v) => v[0] === 'approved').length,
  docs: {},
});

// Profil complet (la personne elle-même, ou un admin).
const fullUser = (p) => ({
  ...publicUser(p),
  email: p.email, phone: p.phone, address: p.address, postal: p.postal, kind: p.kind, shipVolume: p.ship_volume,
  neq: p.neq, status: p.status, ins: p.ins, licClass: p.lic_class, nir: p.nir, tps: p.tps, tvq: p.tvq,
  docs: p.docs || {}, idv: p.idv || null, marketing: p.marketing, hasStripe: !!p.stripe_account_id,
  veh: p.veh || null,
});

const cargoOut = (c, withAddr) => ({
  id: c.id, clientId: c.client_id, status: c.status, createdAt: c.created_at,
  from: { city: c.from_city, date: c.from_date, time: c.from_time, address: withAddr ? c.from_address : '', postal: withAddr ? c.from_postal : '', notes: withAddr ? c.from_notes : '' },
  to: { city: c.to_city, date: c.to_date, time: c.to_time, address: withAddr ? c.to_address : '', postal: withAddr ? c.to_postal : '', notes: withAddr ? c.to_notes : '' },
  goods: c.goods, transport: c.transport, special: c.special, budget: c.budget, km: c.km, offersPending: c.offers_pending,
  hasAddr: !!withAddr,
});

export async function buildState(u) {
  const S = {};
  const admin = u && u.role === 'admin';
  const id = u ? u.id : null;
  S.settings = await settings();

  // ---------- Cargaisons, offres, livraisons ----------
  const cargos = admin
    ? await many('select * from cargos order by created_at desc limit 1000')
    : await many(`select * from cargos c where c.status = any($1) or c.client_id = $2
        or exists (select 1 from offers o where o.cargo_id = c.id and o.carrier_id = $2)
        or exists (select 1 from deliveries d where d.cargo_id = c.id and d.carrier_id = $2)
        order by c.created_at desc limit 1000`, [OPEN, id]);
  const deliveries = !u ? [] : admin
    ? await many('select * from deliveries order by created_at')
    : await many('select * from deliveries where client_id = $1 or carrier_id = $1 order by created_at', [id]);
  // Les cargaisons des livraisons de la personne sont toujours incluses, même anciennes
  // (pour que l’historique des années passées reste consultable en entier).
  const have = new Set(cargos.map((c) => c.id));
  const missing = [...new Set(deliveries.map((d) => d.cargo_id))].filter((x) => !have.has(x));
  if (missing.length) cargos.push(...(await many('select * from cargos where id = any($1)', [missing])));
  const hiredOn = new Set(deliveries.filter((d) => d.carrier_id === id && d.status !== 'CANCELLED').map((d) => d.cargo_id));
  S.cargos = cargos.map((c) => cargoOut(c, admin || c.client_id === id || hiredOn.has(c.id)));

  const offers = !u ? [] : admin
    ? await many('select * from offers order by at')
    : await many('select o.* from offers o join cargos c on c.id = o.cargo_id where o.carrier_id = $1 or c.client_id = $1 order by o.at', [id]);
  S.offers = offers.map((o) => ({ id: o.id, cargoId: o.cargo_id, carrierId: o.carrier_id, price: o.price, availDate: o.avail_date, hours: o.hours, comment: o.comment, vehicle: o.vehicle, trailer: o.trailer, status: o.status, at: o.at }));
  S.deliveries = deliveries.map((d) => ({ id: d.id, cargoId: d.cargo_id, offerId: d.offer_id, clientId: d.client_id, carrierId: d.carrier_id, price: d.price, status: d.status, paymentId: d.payment_id, convId: d.conv_id, createdAt: d.created_at, history: d.history, proof: d.proof, pickupDate: d.pickup_date, deliveredAt: d.delivered_at }));

  // ---------- Paiements, litiges ----------
  const payments = !u ? [] : admin
    ? await many("select * from payments where status not in ('PENDING','FAILED') order by at")
    : await many(`select p.* from payments p where p.status not in ('PENDING','FAILED') and (p.user_id = $1
        or (p.kind = 'transport' and exists (select 1 from deliveries d where d.payment_id = p.id and d.carrier_id = $1))) order by p.at`, [id]);
  S.payments = payments.map((p) => ({ id: p.id, kind: p.kind, refId: p.ref_id, userId: p.user_id, amount: p.amount, b: p.b, status: p.status, refunded: p.refunded, extra: p.extra, at: p.at, events: p.events }));
  const dIds = deliveries.map((d) => d.id);
  const disputes = dIds.length ? await many('select * from disputes where delivery_id = any($1) order by at', [dIds]) : [];
  S.disputes = disputes.map((x) => ({ id: x.id, deliveryId: x.delivery_id, reason: x.reason, desc: x.descr, photos: x.photos, status: x.status, resolution: x.resolution, info: x.info, at: x.at }));

  // ---------- Évaluations, remorques, réservations ----------
  const reviews = await many('select * from reviews order by at desc limit 500');
  S.reviews = reviews.map((r) => ({ id: r.id, kind: r.kind, refId: r.ref_id, from: r.from_id, fromName: r.from_name, to: r.to_id, stars: r.stars, text: r.text, at: r.at }));
  S.trailers = (await many('select * from trailers order by id')).map((t) => ({ id: t.id, no: t.no, name: t.name, brand: t.brand, model: t.model, year: t.year, type: t.type, lf: t.lf, wf: t.wf, cap: t.cap, wt: t.wt, hitch: t.hitch, day: t.day, week: t.week, month: t.month, deposit: t.deposit, desc: t.descr, cond: t.cond, status: t.status, photos: t.photos || [] }));
  const bookings = !u ? [] : admin
    ? await many("select * from bookings where status <> 'PENDING' order by at")
    : await many("select * from bookings where client_id = $1 and status <> 'PENDING' order by at", [id]);
  S.bookings = bookings.map((b) => ({ id: b.id, trailerId: b.trailer_id, clientId: b.client_id, start: b.start_date, end: b.end_date, days: b.days, price: b.price, tps: b.tps, tvq: b.tvq, total: b.total, deposit: b.deposit, depMode: b.dep_mode, chargeNow: b.charge_now, status: b.status, paymentId: b.payment_id, convId: b.conv_id, insp: b.insp || {}, renter: b.renter, at: b.at }));
  // Plages occupées de toutes les remorques (sans dire qui a réservé).
  S.busy = (await many("select trailer_id, start_date, end_date, status from bookings where status in ('PENDING','CONFIRMED','ACTIVE') and end_date >= current_date - 1"))
    .map((b) => ({ trailerId: b.trailer_id, start: b.start_date, end: b.end_date, status: b.status }));

  // ---------- Messagerie, notifications ----------
  const convs = !u ? [] : admin
    ? await many('select * from convs order by last_at desc')
    : await many('select * from convs where $1 = any(members) order by last_at desc', [id]);
  const cIds = convs.map((c) => c.id);
  const msgs = cIds.length ? await many('select * from messages where conv_id = any($1) order by at limit 5000', [cIds]) : [];
  const byConv = {};
  msgs.forEach((m) => (byConv[m.conv_id] ||= []).push({ from: m.from_id, text: m.text, at: m.at, sys: m.sys }));
  S.convs = convs.map((c) => ({ id: c.id, kind: c.kind, refId: c.ref_id, members: c.members, seen: c.seen || {}, msgs: byConv[c.id] || [] }));
  S.notifs = !u ? [] : (await many('select * from notifications where to_id = $1 or to_id = $2 order by at desc limit 100', [id, admin ? 'admin' : id]))
    .map((n) => ({ id: n.id, to: n.to_id, key: n.key, vars: n.vars, link: n.link, at: n.at, read: n.read }));

  // ---------- Profils visibles ----------
  const related = new Set();
  deliveries.forEach((d) => { related.add(d.client_id); related.add(d.carrier_id); });
  convs.forEach((c) => c.members.forEach((m) => m !== 'admin' && related.add(m)));
  offers.forEach((o) => related.add(o.carrier_id));
  const users = admin
    ? await many('select * from users')
    : await many("select * from users where (role = 'carrier' and not deleted) or id = $1 or id = any($2::uuid[])", [id, [...related]]);
  S.users = {};
  users.forEach((p) => { S.users[p.id] = admin || p.id === id ? fullUser(p) : publicUser(p); });
  reviews.forEach((r) => { if (!S.users[r.from_id]) S.users[r.from_id] = { id: r.from_id, role: '', name: r.from_name, company: '', docs: {}, ratingN: 0, ratingSum: 0, stub: true }; });
  S.me = u ? { ...fullUser(u), id: u.id } : null;

  // Fichiers privés : URL signée (1 h), seulement pour ce que la personne peut voir.
  const fix = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const k in o) {
      const v = o[k];
      if (typeof v === 'string' && v.startsWith('priv:')) o[k] = signedUrl(v);
      else if (v && typeof v === 'object') fix(v);
    }
  };
  fix(S);
  return S;
}
