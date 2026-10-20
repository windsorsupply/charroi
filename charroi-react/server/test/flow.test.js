// Test de bout en bout de l’API, en mode simulation (sans Stripe) et base en mémoire.
// Lancer : npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let proc;

const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

async function call(token, method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.status); e.code = j.error; throw e; }
  return j;
}
const act = (tok, name, body) => call(tok, 'POST', `/api/a/${name}`, body);
const state = (tok) => call(tok, 'GET', '/api/state');

before(async () => {
  proc = spawn(process.execPath, [path.join(here, '../src/index.js')], {
    env: { ...process.env, PORT: String(PORT), PGLITE_DIR: ':memory:', STRIPE_SECRET_KEY: '', NODE_ENV: 'test', ADMIN_EMAILS: 'admin@test.ca', UPLOADS_DIR: path.join(here, '.uploads') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  await new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('le serveur n’a pas démarré')), 60000);
    proc.stdout.on('data', (d) => { if (String(d).includes('Charroi en marche')) { clearTimeout(t); ok(); } });
  });
});
after(() => proc && proc.kill());

test('parcours complet : transport, location, litige, droits', async () => {
  // Comptes
  const admin = (await call(null, 'POST', '/api/auth/signup', { email: 'admin@test.ca', password: 'secret123', meta: { firstName: 'Ad', lastName: 'Min' } })).token;
  const client = (await call(null, 'POST', '/api/auth/signup', { email: 'marie@test.ca', password: 'secret123', meta: { role: 'client', firstName: 'Marie', lastName: 'Tremblay', city: 'Montréal', lang: 'fr' } })).token;
  const carrier = (await call(null, 'POST', '/api/auth/signup', { email: 'jean@test.ca', password: 'secret123', meta: { role: 'carrier', firstName: 'Jean', lastName: 'Gagnon', company: 'Transport Gagnon', vehicle: 'cube', taxReg: 'yes', licExp: day(400), insExp: day(300) } })).token;
  await assert.rejects(call(null, 'POST', '/api/auth/signup', { email: 'marie@test.ca', password: 'secret123', meta: {} }), /errEmailUsed/);
  await assert.rejects(call(null, 'POST', '/api/auth/login', { email: 'marie@test.ca', password: 'wrong' }), /errLogin/);
  assert.ok((await call(null, 'POST', '/api/auth/login', { email: 'marie@test.ca', password: 'secret123' })).token);
  assert.equal((await state(admin)).me.role, 'admin');

  // Cargaison avec photo
  const photo = (await call(client, 'POST', '/api/upload', { data: img })).ref;
  const cargoId = await act(client, 'publishCargo', { c: {
    from: { city: 'Montréal', address: '4820, rue Molson', postal: 'H1Y 3J8', date: day(3), time: '08:00' },
    to: { city: 'Québec', address: '275, rue du Marais', postal: 'G1M 3E5', date: day(4), time: '16:00' },
    goods: { type: 'pallets', desc: '2 palettes', weight: 500, pkgs: [{ l: 48, w: 40, h: 60 }], photos: [photo] },
    transport: { vehicle: 'cube' }, budget: 45000, km: 284 } });
  assert.match(cargoId, /^CG-\d+$/);

  // Visiteur : voit la cargaison sans adresse exacte
  const anon = await state(null);
  const pub = anon.cargos.find((c) => c.id === cargoId);
  assert.equal(pub.from.address, '');
  assert.equal(anon.me, null);

  // Transporteur non vérifié : refusé ; versements + approbation par l’admin
  await assert.rejects(act(carrier, 'submitOffer', { cargoId, price: 32500, avail: day(3), hours: 4, vehicle: 'cube' }), /NOT_VERIFIED/);
  const carrierId = (await state(carrier)).me.id;
  await assert.rejects(act(admin, 'verifyCarrier', { userId: carrierId, ok: true }), /STRIPE_NOT_READY/);
  await act(carrier, 'connectOnboard', { web: true });
  await act(admin, 'verifyCarrier', { userId: carrierId, ok: true });
  assert.equal((await state(carrier)).me.verified, true);

  // Offre (coordonnées masquées côté app), paiement simulé
  const offerId = await act(carrier, 'submitOffer', { cargoId, price: 32500, avail: day(3), hours: 4, comment: 'Appelez-moi', vehicle: 'cube' });
  let cs = await state(client);
  assert.equal(cs.cargos.find((c) => c.id === cargoId).status, 'OFFERS_RECEIVED');
  assert.ok(cs.notifs.some((n) => n.key === 'nNewOffer'));
  await assert.rejects(act(carrier, 'transportIntent', { offerId }), /NOT_ALLOWED/);
  const intent = await act(client, 'transportIntent', { offerId });
  assert.equal(intent.simulated, true);
  assert.equal(intent.amount, 32500 + 1625 + 3242); // TPS + TVQ du transporteur inscrit
  const fin = await act(client, 'simulatePay', { paymentId: intent.paymentId });
  const did = fin.deliveryId;
  assert.match(did, /^LV-/);

  // Le transporteur voit maintenant l’adresse
  const crs = await state(carrier);
  assert.equal(crs.cargos.find((c) => c.id === cargoId).from.address, '4820, rue Molson');

  // Livraison : étapes, preuve privée, confirmation, versement
  await assert.rejects(act(carrier, 'advanceDelivery', { deliveryId: did, status: 'IN_TRANSIT' }), /BAD_TRANSITION/);
  await act(carrier, 'advanceDelivery', { deliveryId: did, status: 'PICKED_UP' });
  await act(carrier, 'advanceDelivery', { deliveryId: did, status: 'IN_TRANSIT' });
  const proof = (await call(carrier, 'POST', '/api/upload', { data: img, priv: true })).ref;
  assert.match(proof, /^priv:/);
  await assert.rejects(act(carrier, 'submitProof', { deliveryId: did, proof: { recipient: 'Nadia', photo: photo.replace('/files/pub/', 'priv:') } }), /BAD_FILE/);
  await act(carrier, 'submitProof', { deliveryId: did, proof: { recipient: 'Nadia Roy', photo: proof } });
  cs = await state(client);
  const url = cs.deliveries.find((d) => d.id === did).proof.photo;
  assert.match(url, /^\/files\/priv\/.+\?e=\d+&s=/);
  assert.equal((await fetch(BASE + url)).status, 200);
  assert.equal((await fetch(BASE + url.replace(/s=\w+/, 's=bad'))).status, 403);
  const rel = await act(client, 'confirmDelivery', { deliveryId: did });
  assert.equal(rel.released, true);
  cs = await state(client);
  assert.equal(cs.deliveries.find((d) => d.id === did).status, 'COMPLETED');
  assert.equal(cs.payments.find((p) => p.refId === did).status, 'RELEASED');
  await act(client, 'sendReview', { kind: 'delivery', refId: did, stars: 5, text: 'Parfait' });
  assert.equal((await state(null)).users[carrierId].ratingN, 1);

  // Messagerie
  const convId = cs.deliveries.find((d) => d.id === did).convId;
  await act(client, 'sendMessage', { convId, text: 'Merci !' });
  assert.equal((await state(carrier)).convs.find((c) => c.id === convId).msgs.at(-1).text, 'Merci !');

  // Location : invité, vérification d’identité simulée, double réservation impossible
  const g = (await call(null, 'POST', '/api/auth/guest')).token;
  assert.equal((await state(null)).trailers.length, 0); // aucune remorque de démonstration
  const trailerId = await act(admin, 'saveTrailer', { p: { no: 'R-1', name: ['Fermée 6 × 12', 'Enclosed 6 × 12'], year: 2024, type: 'enclosed', lf: 12, wf: 6, cap: 1400, wt: 700, hitch: '2 po', day: 8500, week: 48000, month: 150000, deposit: 40000, desc: ['', ''], cond: ['', ''] } });
  await assert.rejects(act(g, 'rentalIntent', { trailerId, start: day(10), end: day(12), renter: { name: 'Luc Bergeron', dob: '1985-05-05', email: 'luc@test.ca', phone: '4505550188' } }), /IDV_REQUIRED/);
  await act(g, 'identity', { web: true });
  await assert.rejects(act(g, 'rentalIntent', { trailerId, start: day(10), end: day(12), renter: { name: 'Luc Bergeron', dob: '2015-05-05', email: 'luc@test.ca' } }), /TOO_YOUNG/);
  const ri = await act(g, 'rentalIntent', { trailerId, start: day(10), end: day(12), renter: { name: 'Luc Bergeron', dob: '1985-05-05', email: 'luc@test.ca', phone: '4505550188' } });
  await act(client, 'identity', { web: true });
  await assert.rejects(act(client, 'rentalIntent', { trailerId, start: day(11), end: day(13), renter: { name: 'Marie Tremblay', dob: '1980-01-01' } }), /DATES_TAKEN/);
  const rf = await act(g, 'simulatePay', { paymentId: ri.paymentId });
  assert.match(rf.booking.id, /^RENT-/);
  const bookingId = rf.booking.id;
  assert.equal((await state(g)).bookings[0].status, 'CONFIRMED');
  assert.ok((await state(null)).busy.some((b) => b.trailerId === trailerId));
  await act(admin, 'inspBefore', { bookingId, x: { state: 'good', tires: true } });
  const ia = await act(admin, 'inspectionAfter', { bookingId, data: { state: 'fair', newDmg: true, damageFee: 5000, lateFee: 0 } });
  assert.equal(ia.kept, 5000);
  assert.equal((await state(g)).bookings[0].status, 'COMPLETED');

  // Litige sur une 2e livraison, remboursement partiel
  const c2 = await act(client, 'publishCargo', { c: {
    from: { city: 'Laval', address: '1 rue A', date: day(5) }, to: { city: 'Sherbrooke', address: '2 rue B', date: day(6) },
    goods: { type: 'furniture', desc: 'Bureaux', weight: 300, pkgs: [{ l: 60, w: 30, h: 30 }] }, transport: { vehicle: 'cube' } } });
  const o2 = await act(carrier, 'submitOffer', { cargoId: c2, price: 40000, avail: day(5), vehicle: 'cube' });
  const i2 = await act(client, 'transportIntent', { offerId: o2 });
  const d2 = (await act(client, 'simulatePay', { paymentId: i2.paymentId })).deliveryId;
  await act(carrier, 'advanceDelivery', { deliveryId: d2, status: 'PICKED_UP' });
  await act(carrier, 'advanceDelivery', { deliveryId: d2, status: 'IN_TRANSIT' });
  const pr2 = (await call(carrier, 'POST', '/api/upload', { data: img, priv: true })).ref;
  await act(carrier, 'submitProof', { deliveryId: d2, proof: { recipient: 'X Y', sig: pr2 } });
  const disputeId = await act(client, 'openDispute', { deliveryId: d2, reason: 'damaged', desc: 'Coin abîmé' });
  assert.equal((await act(client, 'confirmDelivery', { deliveryId: d2 }).catch((e) => e.code)), 'NOT_ALLOWED');
  await assert.rejects(act(client, 'resolveDispute', { disputeId, kind: 'refund' }), /ADMIN_ONLY|NOT_ALLOWED/);
  await act(admin, 'resolveDispute', { disputeId, kind: 'partial', amount: 5000 });
  cs = await state(client);
  assert.equal(cs.payments.find((p) => p.refId === d2).status, 'PARTIALLY_REFUNDED');
  assert.equal(cs.disputes.find((x) => x.id === disputeId).resolution, 'resPartial:5000');

  // Confidentialité : le client ne voit pas les données privées du transporteur
  assert.equal(cs.users[carrierId].email, undefined);
  assert.deepEqual(cs.users[carrierId].docs, {});
  assert.equal((await state(admin)).users[carrierId].email, 'jean@test.ca');

  // Historique : transports et locations terminés, par année
  const yr = new Date().getFullYear();
  const hc = await act(client, 'history', {});
  assert.deepEqual(hc.years, [yr]);
  const tc = hc.items.filter((i) => i.kind === 'transport');
  assert.equal(tc.length, 2);
  assert.equal(tc.find((i) => i.id === did).amount, intent.amount);
  assert.equal(tc.find((i) => i.id === did).with, 'Transport Gagnon');
  const hcr = await act(carrier, 'history', {});
  assert.equal(hcr.items.find((i) => i.id === did).amount, (await state(carrier)).payments.find((p) => p.refId === did).b.transfer);
  const hg = await act(g, 'history', {});
  assert.equal(hg.items.length, 1);
  assert.equal(hg.items[0].kind, 'rental');
  const gp = (await state(g)).payments[0];
  assert.equal(hg.items[0].amount, gp.amount + gp.extra - gp.refunded);
  assert.equal(gp.extra, 5000);
  assert.equal((await act(admin, 'history', {})).items.length, 3);
  assert.equal((await act(client, 'history', { year: yr - 1 })).items.length, 0);
  await assert.rejects(act(null, 'history', {}), /AUTH_REQUIRED/);

  // Suppression de compte
  const tmp = (await call(null, 'POST', '/api/auth/signup', { email: 'bye@test.ca', password: 'secret123', meta: { firstName: 'Bye', lastName: 'Bye' } })).token;
  await act(tmp, 'deleteAccount', {});
  await assert.rejects(call(null, 'POST', '/api/auth/login', { email: 'bye@test.ca', password: 'secret123' }), /errLogin/);
});
