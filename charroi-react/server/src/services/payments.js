// Paiements (Stripe) : paiement retenu à l’acceptation d’une offre, versement au transporteur
// après confirmation, litiges, location de remorques (dépôt), Stripe Connect et Stripe Identity.
// La base garde l’état ; Stripe déplace l’argent.
//
// Sans STRIPE_SECRET_KEY et hors production : MODE SIMULATION (aucun argent réel),
// pour tester l’app de bout en bout sur son ordinateur. Désactivé en production.
import Stripe from 'stripe';
import { config, isProd } from '../config.js';
import { many } from '../db.js';
import { work, fail, need, hist, routeStr, settings, str, int, today, isDate } from './common.js';
import { calcTransport, calcRental, cancelRefund, EMAIL } from '../../../shared/pricing.js';
import { sendMail } from '../mailer.js';

const stripe = config.stripeSecret ? new Stripe(config.stripeSecret, { apiVersion: '2025-02-24.acacia' }) : null;
export const SIM = !stripe && !isProd;
if (SIM) console.log('⚠  Paiements en MODE SIMULATION (aucune clé Stripe) : aucun argent réel ne circule.');

const requireStripe = () => { if (!stripe && !SIM) fail('PAYMENTS_DISABLED', 503); };
const simId = (p) => `${p}_sim_${Math.random().toString(36).slice(2, 12)}`;
const evt = (type, amount, extra = {}) => JSON.stringify([{ type, at: new Date().toISOString(), amount, ...extra }]);
// En simulation, adresse relative : fonctionne quelle que soit l’adresse locale utilisée.
const returnUrl = (r, web) => (web ? `${SIM ? '' : config.appUrl}/#/stripe-return/${r}` : `${config.appUrl}/stripe-return?r=${r}`);

// Client Stripe associé au profil (reçus dans la langue choisie).
async function ensureCustomer(u) {
  if (!stripe) return null;
  const locale = u.lang === 'en' ? 'en-CA' : 'fr-CA';
  if (u.stripe_customer_id) {
    await stripe.customers.update(u.stripe_customer_id, { preferred_locales: [locale] }).catch(() => {});
    return u.stripe_customer_id;
  }
  const c = await stripe.customers.create({ email: u.email || undefined, name: u.name || undefined, preferred_locales: [locale], metadata: { user_id: u.id } });
  await work((ctx) => ctx.c.query('update users set stripe_customer_id = $2 where id = $1', [u.id, c.id]));
  return c.id;
}

// ===================== Transport =====================
export async function transportIntent(u, { offerId }) {
  need(u, 'client');
  requireStripe();
  const s = await settings();
  const prep = await work(async (ctx) => {
    const o = (await ctx.c.query('select * from offers where id = $1', [offerId])).rows[0];
    if (!o || o.status !== 'PENDING') fail('OFFER_UNAVAILABLE');
    const c = (await ctx.c.query('select * from cargos where id = $1', [o.cargo_id])).rows[0];
    if (c.client_id !== u.id) fail('NOT_ALLOWED', 403);
    const taken = (await ctx.c.query("select 1 from deliveries where cargo_id = $1 and status <> 'CANCELLED'", [c.id])).rows.length;
    if (taken) fail('ALREADY_ASSIGNED');
    const cr = (await ctx.c.query('select verified, tax_reg from users where id = $1', [o.carrier_id])).rows[0];
    if (!cr.verified) fail('CARRIER_NOT_VERIFIED');
    const b = calcTransport(o.price, cr.tax_reg, s);
    // Réutilise un paiement en attente pour la même offre (fenêtre fermée puis rouverte).
    let p = (await ctx.c.query("select * from payments where kind = 'transport' and status = 'PENDING' and payload->>'offerId' = $1 and user_id = $2", [offerId, u.id])).rows[0];
    if (p) p = (await ctx.c.query('update payments set amount = $2, b = $3 where id = $1 returning *', [p.id, b.total, JSON.stringify(b)])).rows[0];
    else p = (await ctx.c.query("insert into payments (kind, ref_id, user_id, amount, b, payload) values ('transport', $1, $2, $3, $4, $5) returning *",
      [offerId, u.id, b.total, JSON.stringify(b), JSON.stringify({ offerId })])).rows[0];
    return { p, cargoId: c.id };
  });
  const { p } = prep;
  if (SIM) return { simulated: true, paymentId: p.id, amount: p.amount };
  const customer = await ensureCustomer(u);
  let pi = p.stripe_pi ? await stripe.paymentIntents.retrieve(p.stripe_pi) : null;
  if (pi && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
    if (pi.amount !== p.amount) pi = await stripe.paymentIntents.update(pi.id, { amount: p.amount });
  } else {
    pi = await stripe.paymentIntents.create({
      amount: p.amount, currency: 'cad', customer, automatic_payment_methods: { enabled: true },
      transfer_group: p.id, description: `Charroi transport ${prep.cargoId}`,
      metadata: { kind: 'transport', payment_id: p.id, user_id: u.id },
    }, { idempotencyKey: `pi-${p.id}-${p.amount}` });
    await work((ctx) => ctx.c.query('update payments set stripe_pi = $2 where id = $1', [p.id, pi.id]));
  }
  return { clientSecret: pi.client_secret, paymentId: p.id, amount: p.amount };
}

export async function finalizeTransport(paymentId, pm) {
  const r = await work(async (ctx) => {
    const p = (await ctx.c.query('select * from payments where id = $1 for update', [paymentId])).rows[0];
    if (!p || p.status !== 'PENDING') return { already: true };
    const o = (await ctx.c.query('select * from offers where id = $1 for update', [p.payload.offerId])).rows[0];
    const c = (await ctx.c.query('select * from cargos where id = $1 for update', [o.cargo_id])).rows[0];
    const taken = (await ctx.c.query("select 1 from deliveries where cargo_id = $1 and status <> 'CANCELLED'", [c.id])).rows.length;
    if (o.status !== 'PENDING' || taken) {
      await ctx.c.query("update payments set status = 'FAILED' where id = $1", [p.id]);
      ctx.touch(p.user_id);
      return { conflict: true, pi: p.stripe_pi };
    }
    const n = (await ctx.c.query("select nextval('deliv_seq') n")).rows[0].n;
    const did = `LV-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`;
    const cv = (await ctx.c.query("insert into convs (kind, ref_id, members) values ('transport', $1, $2) returning id", [did, [c.client_id, o.carrier_id]])).rows[0].id;
    await ctx.c.query("update payments set status = 'CAPTURED', ref_id = $2, stripe_pm = $3, events = events || $4::jsonb where id = $1", [p.id, did, pm, evt('payment_intent.succeeded', p.amount)]);
    await ctx.c.query(`insert into deliveries (id, cargo_id, offer_id, client_id, carrier_id, price, payment_id, conv_id, history, pickup_date)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [did, c.id, o.id, c.client_id, o.carrier_id, o.price, p.id, cv, hist([], 'SCHEDULED'), o.avail_date]);
    await ctx.c.query("update offers set status = 'ACCEPTED' where id = $1", [o.id]);
    const route = `${c.from_city} → ${c.to_city}`;
    const rej = (await ctx.c.query("update offers set status = 'REJECTED' where cargo_id = $1 and id <> $2 and status = 'PENDING' returning carrier_id", [c.id, o.id])).rows;
    for (const x of rej) await ctx.notify(x.carrier_id, 'nOfferRejected', { r: route }, `#/cargo/${c.id}`);
    await ctx.c.query("update cargos set status = 'TRANSPORTER_SELECTED', offers_pending = 0 where id = $1", [c.id]);
    await ctx.notify(o.carrier_id, 'nOfferAccepted', { r: route, d: o.avail_date }, `#/delivery/${did}`);
    await ctx.notify(c.client_id, 'nPaid', { r: route }, `#/delivery/${did}`);
    ctx.touch('all', 'admin');
    return { deliveryId: did };
  });
  // Quelqu’un a déjà été choisi entre-temps : remboursement automatique.
  if (r.conflict && stripe && r.pi) await stripe.refunds.create({ payment_intent: r.pi }, { idempotencyKey: `conflict-${r.pi}` });
  return r;
}

// Versement au transporteur depuis les fonds détenus par la plateforme.
async function payout({ pi, amount, account, group }) {
  if (SIM) return simId('tr');
  if (!account) fail('CARRIER_NO_STRIPE');
  if (amount <= 0) return null;
  const intent = await stripe.paymentIntents.retrieve(pi);
  const tr = await stripe.transfers.create({
    amount, currency: 'cad', destination: account, transfer_group: group,
    source_transaction: typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id,
  }, { idempotencyKey: `transfer-${group}-${amount}` });
  return tr.id;
}

async function markReleased(deliveryId, transferId, amount) {
  await work(async (ctx) => {
    const d = (await ctx.c.query('select * from deliveries where id = $1 for update', [deliveryId])).rows[0];
    if (d.status === 'COMPLETED') return;
    await ctx.c.query(`update payments set status = case when refunded > 0 then 'PARTIALLY_REFUNDED' else 'RELEASED' end,
      stripe_transfer = $2, events = events || $3::jsonb where id = $1`, [d.payment_id, transferId, evt('transfer.created', amount)]);
    await ctx.c.query("update deliveries set status = 'COMPLETED', history = $2 where id = $1", [d.id, hist(d.history, 'COMPLETED')]);
    await ctx.c.query("update cargos set status = 'CLOSED' where id = $1", [d.cargo_id]);
    await ctx.c.query('update users set deliveries = deliveries + 1 where id = $1', [d.carrier_id]);
    await ctx.notify(d.carrier_id, 'nReleased', { p: amount, r: await routeStr(ctx.c, d.cargo_id) }, `#/delivery/${d.id}`);
    ctx.touch('all', 'admin');
  });
}

// mode : 'client' (le client confirme), 'admin' (confirmation manuelle ou nouvel essai), 'auto' (délai écoulé).
async function confirmAndRelease(deliveryId, actor, mode) {
  const s = await settings();
  const info = await work(async (ctx) => {
    const d = (await ctx.c.query('select * from deliveries where id = $1 for update', [deliveryId])).rows[0];
    if (!d) fail('NOT_FOUND', 404);
    if (mode === 'client' && (d.client_id !== actor?.id || d.status !== 'DELIVERED')) fail('NOT_ALLOWED', 403);
    if (mode === 'admin' && (actor?.role !== 'admin' || !['DELIVERED', 'CONFIRMED'].includes(d.status))) fail('NOT_ALLOWED', 403);
    if (mode === 'auto' && (d.status !== 'DELIVERED' || new Date(d.delivered_at).getTime() + s.autoConfirmH * 3600e3 > Date.now())) return { release: false };
    if (d.status === 'DELIVERED') await ctx.c.query("update deliveries set status = 'CONFIRMED', history = $2 where id = $1", [d.id, hist(d.history, 'CONFIRMED')]);
    ctx.touch(d.client_id, d.carrier_id, 'admin');
    const open = (await ctx.c.query("select 1 from disputes where delivery_id = $1 and status = 'OPEN'", [d.id])).rows.length;
    if (open) return { release: false, reason: 'DISPUTE_OPEN' };
    const p = (await ctx.c.query('select * from payments where id = $1', [d.payment_id])).rows[0];
    if (p.status !== 'CAPTURED') return { release: false, reason: 'NOT_CAPTURED' };
    const acct = (await ctx.c.query('select stripe_account_id from users where id = $1', [d.carrier_id])).rows[0].stripe_account_id;
    return { release: true, amount: p.b.transfer, account: acct, pi: p.stripe_pi, group: d.id };
  });
  if (!info.release) return { released: false, reason: info.reason || null };
  try {
    const tr = await payout(info);
    await markReleased(deliveryId, tr, info.amount);
    return { released: true };
  } catch (e) {
    // La livraison reste « Confirmée » ; un admin pourra relancer le versement.
    console.error('payout', deliveryId, e.message);
    await work((ctx) => ctx.notify('admin', 'nPayoutFailed', { r: deliveryId }, `#/delivery/${deliveryId}`)).catch(() => {});
    return { released: false, reason: e.code && !e.type ? e.code : 'PAYOUT_FAILED' };
  }
}

export const confirmDelivery = (u, { deliveryId, admin }) => (need(u), confirmAndRelease(deliveryId, u, admin ? 'admin' : 'client'));

export async function autoConfirm() {
  const s = await settings();
  const due = await many("select id from deliveries where status = 'DELIVERED' and delivered_at + make_interval(hours => $1) <= now()", [s.autoConfirmH]);
  for (const d of due) await confirmAndRelease(d.id, null, 'auto').catch((e) => console.error('auto-confirm', d.id, e.message));
  return due.length;
}

// ===================== Litiges (admin) =====================
export async function resolveDispute(u, { disputeId, kind, amount }) {
  need(u, 'admin');
  const x = await work(async (ctx) => {
    const dp = (await ctx.c.query('select * from disputes where id = $1', [disputeId])).rows[0];
    if (!dp || dp.status !== 'OPEN') fail('ALREADY_RESOLVED');
    const d = (await ctx.c.query('select * from deliveries where id = $1', [dp.delivery_id])).rows[0];
    const p = (await ctx.c.query('select * from payments where id = $1', [d.payment_id])).rows[0];
    const acct = (await ctx.c.query('select stripe_account_id from users where id = $1', [d.carrier_id])).rows[0].stripe_account_id;
    return { d, p, acct };
  });
  const { d, p } = x;
  if (kind === 'hold') return { ok: true };
  if (kind === 'info') {
    await work(async (ctx) => {
      await ctx.c.query('update disputes set info = true where id = $1', [disputeId]);
      await ctx.c.query("insert into messages (conv_id, from_id, text, sys) values ($1, 'admin', 'infoMsg', true)", [d.conv_id]);
      await ctx.c.query('update convs set last_at = now() where id = $1', [d.conv_id]);
      await ctx.notify(d.client_id, 'nMsg', { r: d.id }, `#/chat/${d.conv_id}`);
      await ctx.notify(d.carrier_id, 'nMsg', { r: d.id }, `#/chat/${d.conv_id}`);
    });
    return { ok: true };
  }
  requireStripe();
  let a = 0, tr = null, rest = 0;
  if (kind === 'refund') {
    if (!SIM) await stripe.refunds.create({ payment_intent: p.stripe_pi }, { idempotencyKey: `refund-${disputeId}` });
  } else if (kind === 'partial') {
    a = int(amount);
    if (!(a > 0 && a < p.amount)) fail('errAmount');
    if (!SIM) await stripe.refunds.create({ payment_intent: p.stripe_pi, amount: a }, { idempotencyKey: `refund-${disputeId}-${a}` });
    rest = Math.max(0, p.b.transfer - a);
    if (rest > 0) tr = await payout({ pi: p.stripe_pi, amount: rest, account: x.acct, group: d.id });
  } else if (kind === 'release') {
    rest = p.b.transfer;
    tr = await payout({ pi: p.stripe_pi, amount: rest, account: x.acct, group: d.id });
  } else fail('BAD_INPUT');

  await work(async (ctx) => {
    if (kind === 'refund') {
      await ctx.c.query("update payments set status = 'REFUNDED', refunded = amount, events = events || $2::jsonb where id = $1", [p.id, evt('charge.refunded', p.amount - p.refunded)]);
      await ctx.c.query("update disputes set status = 'RESOLVED', resolution = 'resRefund' where id = $1", [disputeId]);
      await ctx.c.query("update deliveries set status = 'CANCELLED', history = $2 where id = $1", [d.id, hist(d.history, 'CANCELLED')]);
      await ctx.c.query("update cargos set status = 'CANCELLED' where id = $1", [d.cargo_id]);
      await ctx.notify(d.client_id, 'nRefund', { p: p.amount, r: d.id }, `#/delivery/${d.id}`);
    } else if (kind === 'partial') {
      const ev = JSON.stringify([...JSON.parse(evt('charge.refunded', a)), ...JSON.parse(evt('transfer.created', rest))]);
      await ctx.c.query(`update payments set status = 'PARTIALLY_REFUNDED', refunded = refunded + $2, stripe_transfer = $3,
        b = jsonb_set(b, '{transfer}', to_jsonb($4::int)), events = events || $5::jsonb where id = $1`, [p.id, a, tr, rest, ev]);
      await ctx.c.query("update disputes set status = 'RESOLVED', resolution = $2 where id = $1", [disputeId, `resPartial:${a}`]);
      await ctx.c.query("update deliveries set status = 'COMPLETED', history = $2 where id = $1", [d.id, hist(d.history, 'COMPLETED')]);
      await ctx.c.query("update cargos set status = 'CLOSED' where id = $1", [d.cargo_id]);
      await ctx.c.query('update users set deliveries = deliveries + 1 where id = $1', [d.carrier_id]);
      await ctx.notify(d.client_id, 'nRefund', { p: a, r: d.id }, `#/delivery/${d.id}`);
    } else {
      await ctx.c.query("update disputes set status = 'RESOLVED', resolution = 'resRelease' where id = $1", [disputeId]);
      await ctx.c.query('update deliveries set history = $2 where id = $1', [d.id, hist(d.history, 'CONFIRMED')]);
    }
    await ctx.notify(d.client_id, 'nDisputeRes', { r: d.id }, `#/delivery/${d.id}`);
    await ctx.notify(d.carrier_id, 'nDisputeRes', { r: d.id }, `#/delivery/${d.id}`);
    ctx.touch('all', 'admin');
  });
  if (kind === 'release') await markReleased(d.id, tr, rest);
  return { ok: true };
}

// ===================== Location de remorques =====================
export async function rentalIntent(u, { trailerId, start, end, renter }) {
  need(u);
  if (u.role === 'admin') fail('ADMIN_CANNOT_BOOK');
  requireStripe();
  renter = renter || {};
  const s = await settings();
  if (!isDate(start) || !isDate(end) || start < today() || end <= start) fail('BAD_DATES');
  if (str(renter.name).split(/\s+/).length < 2) fail('FULL_NAME');
  if (!isDate(renter.dob)) fail('TOO_YOUNG');
  const age = (() => { const b = new Date(renter.dob + 'T12:00'), d = new Date(start + 'T12:00'); let a = d.getFullYear() - b.getFullYear(); if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--; return a; })();
  if (age < s.minAge) fail('TOO_YOUNG');
  if (!u.idv || u.idv.status !== 'verified') fail('IDV_REQUIRED');
  if (u.role === 'guest' && !EMAIL.test(str(renter.email))) fail('BAD_EMAIL');

  const prep = await work(async (ctx) => {
    const tr = (await ctx.c.query('select * from trailers where id = $1', [trailerId])).rows[0];
    if (!tr || tr.status !== 'AVAILABLE') fail('TRAILER_UNAVAILABLE');
    if (u.role === 'guest') await ctx.c.query('update users set name = $2, email = coalesce(email, $3), phone = $4 where id = $1', [u.id, str(renter.name, 120), str(renter.email, 200).toLowerCase(), str(renter.phone, 30)]);
    const q = calcRental(tr, start, end, s);
    const n = (await ctx.c.query("select nextval('rent_seq') n")).rows[0].n;
    const bid = `RENT-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`;
    const p = (await ctx.c.query("insert into payments (kind, ref_id, user_id, amount, b, payload) values ('rental', $1, $2, $3, $4, $5) returning *",
      [bid, u.id, q.chargeNow, JSON.stringify(q), JSON.stringify({ bookingId: bid })])).rows[0];
    const r = { name: str(renter.name, 120), dob: renter.dob, email: str(renter.email, 200) || null, phone: str(renter.phone, 30) || null, idv: u.idv };
    await ctx.c.query('savepoint b');
    try {
      await ctx.c.query(`insert into bookings (id, trailer_id, client_id, start_date, end_date, days, price, tps, tvq, total, deposit, dep_mode, charge_now, payment_id, renter)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [bid, trailerId, u.id, start, end, q.days, q.price, q.tps, q.tvq, q.total, q.deposit, q.depMode, q.chargeNow, p.id, JSON.stringify(r)]);
    } catch (e) {
      if (e.code === '23P01') fail('DATES_TAKEN');
      throw e;
    }
    ctx.touch('all');
    return { p, bid, trailer: tr };
  });
  const { p, bid } = prep;
  if (SIM) return { simulated: true, paymentId: p.id, bookingId: bid, amount: p.amount };
  const customer = await ensureCustomer(u);
  const pi = await stripe.paymentIntents.create({
    amount: p.amount, currency: 'cad', customer, automatic_payment_methods: { enabled: true },
    // Carte enregistrée : dépôt, frais de dommages ou de retard après la location.
    setup_future_usage: 'off_session', description: `Charroi location ${bid}`,
    metadata: { kind: 'rental', payment_id: p.id, booking_id: bid, user_id: u.id },
  }, { idempotencyKey: `pi-${p.id}` });
  await work((ctx) => ctx.c.query('update payments set stripe_pi = $2 where id = $1', [p.id, pi.id]));
  return { clientSecret: pi.client_secret, paymentId: p.id, bookingId: bid, amount: p.amount };
}

export async function finalizeRental(paymentId, pm, customer) {
  const r = await work(async (ctx) => {
    const p = (await ctx.c.query('select * from payments where id = $1 for update', [paymentId])).rows[0];
    if (!p || p.status !== 'PENDING') return { already: true };
    const b = (await ctx.c.query('select b.*, t.name tname from bookings b join trailers t on t.id = b.trailer_id where b.payment_id = $1 for update of b', [p.id])).rows[0];
    if (!b || b.status !== 'PENDING') {
      // La réservation a expiré pendant le paiement : remboursement.
      await ctx.c.query("update payments set status = 'FAILED' where id = $1", [p.id]);
      return { conflict: true, pi: p.stripe_pi };
    }
    const cv = (await ctx.c.query("insert into convs (kind, ref_id, members) values ('rental', $1, $2) returning id", [b.id, [b.client_id, 'admin']])).rows[0].id;
    await ctx.c.query("update payments set status = 'PAID', stripe_pm = $2, events = events || $3::jsonb where id = $1", [p.id, pm, evt('payment_intent.succeeded', p.amount)]);
    await ctx.c.query("update bookings set status = 'CONFIRMED', conv_id = $2 where id = $1", [b.id, cv]);
    await ctx.notify(b.client_id, 'nBooked', { id: b.id }, `#/booking/${b.id}`);
    await ctx.notify('admin', 'nNewBooking', { id: b.id }, `#/booking/${b.id}`);
    const cl = (await ctx.c.query('select role, email, lang from users where id = $1', [b.client_id])).rows[0];
    ctx.touch('all', 'admin');
    return { booking: b, client: cl };
  });
  if (r.conflict && stripe && r.pi) await stripe.refunds.create({ payment_intent: r.pi }, { idempotencyKey: `conflict-${r.pi}` });
  if (r.booking) {
    const b = r.booking;
    // Dépôt : autorisation sur la carte, prélevée seulement en cas de dommages.
    if (stripe && b.dep_mode === 'auth' && b.deposit > 0 && pm) {
      try {
        const dep = await stripe.paymentIntents.create({
          amount: b.deposit, currency: 'cad', customer, payment_method: pm, capture_method: 'manual', off_session: true, confirm: true,
          description: `Charroi dépôt ${b.id}`, metadata: { kind: 'deposit', payment_id: paymentId, booking_id: b.id },
        }, { idempotencyKey: `deposit-${paymentId}` });
        await work((ctx) => ctx.c.query('update payments set stripe_deposit_pi = $2, events = events || $3::jsonb where id = $1', [paymentId, dep.id, evt('deposit.authorized', b.deposit)]));
      } catch (e) {
        console.error('deposit', b.id, e.message);
        await work((ctx) => ctx.notify('admin', 'nDepositFailed', { id: b.id }, `#/booking/${b.id}`));
      }
    }
    // Invité : confirmation par courriel.
    if (r.client.role === 'guest' && r.client.email) {
      const name = Array.isArray(b.tname) ? b.tname[r.client.lang === 'en' ? 1 : 0] : b.tname;
      await sendMail(r.client.email, r.client.lang, 'booking', { id: b.id, t: name, a: b.start_date, b: b.end_date, link: `${config.appUrl}/#/booking/${b.id}` }).catch((e) => console.error('mail', e.message));
    }
  }
  return r;
}

// Mode simulation seulement : « payer » sans Stripe.
export async function simulatePay(u, { paymentId }) {
  need(u);
  if (!SIM) fail('NOT_ALLOWED', 403);
  const p = (await many('select * from payments where id = $1', [paymentId]))[0];
  if (!p || p.user_id !== u.id) fail('NOT_ALLOWED', 403);
  return p.kind === 'transport' ? finalizeTransport(p.id, null) : finalizeRental(p.id, null, null);
}

export async function paymentStatus(u, { paymentId }) {
  need(u);
  const p = (await many('select status, ref_id, user_id from payments where id = $1', [paymentId]))[0];
  if (!p || p.user_id !== u.id) fail('NOT_FOUND', 404);
  return { status: p.status, refId: p.ref_id };
}

export async function cancelBooking(u, { bookingId }) {
  need(u);
  const s = await settings();
  const c = await work(async (ctx) => {
    const b = (await ctx.c.query('select * from bookings where id = $1', [bookingId])).rows[0];
    if (!b || b.client_id !== u.id || b.status !== 'CONFIRMED') fail('NOT_ALLOWED', 403);
    const p = (await ctx.c.query('select * from payments where id = $1', [b.payment_id])).rows[0];
    return { ...cancelRefund({ start: b.start_date, price: b.price }, p.amount, p.refunded, s), p };
  });
  if (stripe) {
    if (c.refund > 0) await stripe.refunds.create({ payment_intent: c.p.stripe_pi, amount: c.refund }, { idempotencyKey: `cancel-${bookingId}` });
    if (c.p.stripe_deposit_pi) await stripe.paymentIntents.cancel(c.p.stripe_deposit_pi).catch(() => {});
  }
  await work(async (ctx) => {
    await ctx.c.query("update bookings set status = 'CANCELLED' where id = $1", [bookingId]);
    await ctx.c.query("update payments set refunded = refunded + $2, status = $3, events = events || $4::jsonb where id = $1",
      [c.p.id, c.refund, c.keep > 0 ? 'PAID' : 'REFUNDED', evt('charge.refunded', c.refund)]);
    ctx.touch('all', 'admin');
  });
  return { refund: c.refund };
}

// Retour de la remorque : dommages et retard retenus sur le dépôt, surplus facturé à la carte.
export async function inspectionAfter(u, { bookingId, data }) {
  need(u, 'admin');
  data = data || {};
  const { ownRefs } = await import('../storage.js');
  const b = await work(async (ctx) => {
    const r = (await ctx.c.query('select b.*, p.stripe_pi, p.stripe_deposit_pi, p.stripe_pm, p.id pid, x.stripe_customer_id cus from bookings b join payments p on p.id = b.payment_id join users x on x.id = b.client_id where b.id = $1', [bookingId])).rows[0];
    if (!r || r.status !== 'ACTIVE') fail('NOT_ALLOWED', 403);
    r.photos = await ownRefs(ctx.c, u, (data.photos || []).slice(0, 4), { priv: true });
    return r;
  });
  const fees = (data.newDmg ? Math.max(0, int(data.damageFee)) : 0) + Math.max(0, int(data.lateFee));
  const kept = Math.min(fees, b.deposit);
  let extra = Math.max(0, fees - b.deposit), refund = 0;
  const offSession = (amount, label) => stripe.paymentIntents.create({
    amount, currency: 'cad', customer: b.cus, payment_method: b.stripe_pm, off_session: true, confirm: true,
    description: `Charroi ${bookingId} ${label}`, metadata: { kind: 'extra', payment_id: b.pid },
  }, { idempotencyKey: `${label}-${bookingId}-${amount}` });
  if (b.dep_mode === 'capture') {
    refund = b.deposit - kept;
    if (refund > 0 && stripe) await stripe.refunds.create({ payment_intent: b.stripe_pi, amount: refund }, { idempotencyKey: `deposit-${bookingId}` });
  } else if (stripe && b.stripe_deposit_pi) {
    if (kept > 0) await stripe.paymentIntents.capture(b.stripe_deposit_pi, { amount_to_capture: kept });
    else await stripe.paymentIntents.cancel(b.stripe_deposit_pi).catch(() => {});
  } else if (stripe && kept > 0) {
    await offSession(kept, 'deposit');
  }
  if (extra > 0 && stripe) {
    try { await offSession(extra, 'fees'); } catch (e) { console.error('extra fees', e.message); extra = 0; }
  }
  const x = { state: ['good', 'fair', 'poor'].includes(data.state) ? data.state : 'good', comments: str(data.comments, 1000), photos: b.photos, newDmg: !!data.newDmg, fees, kept, extra, at: new Date().toISOString() };
  await work(async (ctx) => {
    await ctx.c.query("update bookings set status = 'COMPLETED', insp = insp || jsonb_build_object('after', $2::jsonb) where id = $1", [bookingId, JSON.stringify(x)]);
    const ev = [];
    if (refund > 0) ev.push(...JSON.parse(evt('charge.refunded', refund)));
    if (kept > 0) ev.push(...JSON.parse(evt('deposit.kept', kept)));
    if (extra > 0) ev.push(...JSON.parse(evt('payment_intent.succeeded', extra, { label: 'fees' })));
    await ctx.c.query('update payments set refunded = refunded + $2, extra = extra + $3, events = events || $4::jsonb where id = $1',
      [b.pid, refund, (b.dep_mode === 'auth' ? kept : 0) + extra, JSON.stringify(ev)]);
    await ctx.notify(b.client_id, 'nRentDone', { id: bookingId }, `#/booking/${bookingId}`);
    ctx.touch('all', 'admin');
  });
  return { kept, extra, refund };
}

// ===================== Stripe Connect (versements aux transporteurs) =====================
async function setStripeReady(userId, ready) {
  await work(async (ctx) => {
    const docs = (await ctx.c.query('select docs from users where id = $1', [userId])).rows[0].docs || {};
    docs.stripe = [ready ? 'approved' : 'pending', '', null];
    await ctx.c.query('update users set docs = $2 where id = $1', [userId, JSON.stringify(docs)]);
    ctx.touch(userId, 'admin');
  });
}

export async function connectOnboard(u, { web }) {
  need(u, 'carrier');
  requireStripe();
  if (SIM) {
    await work((ctx) => ctx.c.query("update users set stripe_account_id = 'acct_sim' where id = $1", [u.id]));
    await setStripeReady(u.id, true);
    return { url: returnUrl('connect', web) };
  }
  let account = u.stripe_account_id;
  if (!account) {
    const a = await stripe.accounts.create({
      type: 'express', country: 'CA', email: u.email || undefined,
      business_type: u.status === 'inc' ? 'company' : 'individual',
      capabilities: { transfers: { requested: true } },
      business_profile: { mcc: '4214', product_description: 'Transport de marchandises (Charroi)' },
      metadata: { user_id: u.id },
    });
    account = a.id;
    await work((ctx) => ctx.c.query('update users set stripe_account_id = $2 where id = $1', [u.id, account]));
  }
  const link = await stripe.accountLinks.create({ account, refresh_url: returnUrl('connect-refresh', web), return_url: returnUrl('connect', web), type: 'account_onboarding' });
  return { url: link.url };
}

export async function connectStatus(u) {
  need(u, 'carrier');
  if (SIM || !u.stripe_account_id) return { ready: !!u.stripe_account_id };
  const a = await stripe.accounts.retrieve(u.stripe_account_id);
  const ready = !!a.payouts_enabled && a.capabilities?.transfers === 'active';
  await setStripeReady(u.id, ready);
  return { ready };
}

// ===================== Stripe Identity (pièce d’identité + égoportrait) =====================
async function setIdv(userId, idv) {
  await work(async (ctx) => {
    await ctx.c.query('update users set idv = $2 where id = $1', [userId, JSON.stringify(idv)]);
    ctx.touch(userId, 'admin');
  });
}

export async function identity(u, { web }) {
  need(u);
  requireStripe();
  if (SIM) {
    await setIdv(u.id, { status: 'verified', id: simId('vs'), at: new Date().toISOString(), doc: 'driving_license', simulated: true });
    return { url: returnUrl('identity', web) };
  }
  const s = await stripe.identity.verificationSessions.create({
    type: 'document',
    options: { document: { allowed_types: ['driving_license'], require_matching_selfie: true, require_live_capture: true } },
    metadata: { user_id: u.id }, return_url: returnUrl('identity', web),
  });
  await setIdv(u.id, { status: 'pending', id: s.id, at: new Date().toISOString() });
  return { url: s.url };
}

export async function identityStatus(u) {
  need(u);
  const id = u.idv && u.idv.id;
  if (!id || SIM) return u.idv || { status: null };
  const s = await stripe.identity.verificationSessions.retrieve(id);
  const status = s.status === 'verified' ? 'verified' : s.status === 'requires_input' ? 'failed' : 'pending';
  const idv = { status, id, at: new Date().toISOString(), doc: 'driving_license' };
  await setIdv(u.id, idv);
  return idv;
}

// ===================== Webhook Stripe =====================
export async function handleWebhook(raw, signature) {
  if (!stripe) fail('PAYMENTS_DISABLED', 503);
  const event = stripe.webhooks.constructEvent(raw, signature, config.stripeWebhookSecret);
  const o = event.data.object;
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pm = typeof o.payment_method === 'string' ? o.payment_method : o.payment_method?.id || null;
      if (o.metadata?.kind === 'transport') await finalizeTransport(o.metadata.payment_id, pm);
      if (o.metadata?.kind === 'rental') await finalizeRental(o.metadata.payment_id, pm, o.customer);
      break;
    }
    case 'payment_intent.canceled':
      if (['transport', 'rental'].includes(o.metadata?.kind)) {
        await work(async (ctx) => {
          const p = (await ctx.c.query("update payments set status = 'FAILED' where stripe_pi = $1 and status = 'PENDING' returning id, kind", [o.id])).rows[0];
          if (p && p.kind === 'rental') await ctx.c.query("update bookings set status = 'CANCELLED' where payment_id = $1 and status = 'PENDING'", [p.id]);
          ctx.touch('all');
        });
      }
      break;
    case 'account.updated': {
      const ready = !!o.payouts_enabled && o.capabilities?.transfers === 'active';
      const u = (await many('select id from users where stripe_account_id = $1', [o.id]))[0];
      if (u) await setStripeReady(u.id, ready);
      break;
    }
    case 'identity.verification_session.verified':
    case 'identity.verification_session.requires_input':
      if (o.metadata?.user_id) await setIdv(o.metadata.user_id, { status: event.type.endsWith('verified') ? 'verified' : 'failed', id: o.id, at: new Date().toISOString(), doc: 'driving_license' });
      break;
  }
  return { received: true };
}

// ===================== Tâches planifiées =====================
// Réservations non payées après 30 minutes : libérées.
export async function expirePending() {
  await work(async (ctx) => {
    const r = await ctx.c.query("update bookings set status = 'CANCELLED' where status = 'PENDING' and at < now() - interval '30 minutes' returning id");
    await ctx.c.query("update payments set status = 'FAILED' where status = 'PENDING' and at < now() - interval '2 hours'");
    if (r.rows.length) ctx.touch('all');
  });
}

// ===================== Suppression de compte (exigée par Apple et Google) =====================
export async function deleteAccount(u) {
  need(u);
  await work(async (ctx) => {
    const act = (await ctx.c.query("select 1 from deliveries where (client_id = $1 or carrier_id = $1) and status not in ('COMPLETED','CANCELLED')", [u.id])).rows.length;
    if (act) fail('ACTIVE_DELIVERIES');
    const bk = (await ctx.c.query("select 1 from bookings where client_id = $1 and status in ('CONFIRMED','ACTIVE')", [u.id])).rows.length;
    if (bk) fail('ACTIVE_BOOKINGS');
    await ctx.c.query("update cargos set status = 'CANCELLED' where client_id = $1 and status in ('PUBLISHED','OFFERS_RECEIVED')", [u.id]);
    const w = (await ctx.c.query("update offers set status = 'WITHDRAWN' where carrier_id = $1 and status = 'PENDING' returning cargo_id", [u.id])).rows;
    for (const x of w) {
      const n = (await ctx.c.query("select count(*)::int n from offers where cargo_id = $1 and status = 'PENDING'", [x.cargo_id])).rows[0].n;
      await ctx.c.query("update cargos set offers_pending = $2, status = case when status in ('PUBLISHED','OFFERS_RECEIVED') then (case when $2 > 0 then 'OFFERS_RECEIVED' else 'PUBLISHED' end) else status end where id = $1", [x.cargo_id, n]);
    }
    // Les reçus et l’historique des transactions sont conservés (obligations comptables) ; le profil est anonymisé.
    await ctx.c.query(`update users set email = null, password_hash = null, name = '', company = '', photo = null, phone = null, address = null,
      postal = null, neq = null, descr = null, veh = null, ins = null, lic_class = null, nir = null, docs = '{}', idv = null,
      marketing = false, verified = false, deleted = true where id = $1`, [u.id]);
    await ctx.c.query('delete from push_tokens where user_id = $1', [u.id]);
    await ctx.c.query('delete from notifications where to_id = $1', [u.id]);
    ctx.touch('all');
  });
  return { ok: true };
}
