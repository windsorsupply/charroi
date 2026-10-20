// Historique sur plusieurs années : les activités d’années passées restent classées par année.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PGLITE_DIR = ':memory:';
process.env.NODE_ENV = 'test';
const { connect, query, one } = await import('../src/db.js');
const { history } = await import('../src/services/history.js');
await connect();

test('transports et locations des années passées, classés par année', async () => {
  const cl = await one("insert into users (email, role, name) values ('c@t.ca','client','Cli Ent') returning *");
  const cr = await one("insert into users (email, role, name, company, verified) values ('r@t.ca','carrier','Car Rier','Transport X',true) returning *");
  const ad = await one("insert into users (email, role, name) values ('a@t.ca','admin','Ad Min') returning *");
  const other = await one("insert into users (email, role, name) values ('o@t.ca','client','Oth Er') returning *");

  // Un transport terminé par année (2023, 2024), et un d’un autre client.
  async function transport(client, yearDate, price) {
    const c = await one(`insert into cargos (client_id, status, from_city, from_date, to_city, to_date, goods, transport)
      values ($1, 'CLOSED', 'Montréal', $2, 'Québec', $2, '{"type":"pallets","weight":100}', '{"vehicle":"cube"}') returning id`, [client.id, yearDate]);
    const o = await one("insert into offers (cargo_id, carrier_id, price, avail_date, vehicle, status) values ($1,$2,$3,$4,'cube','ACCEPTED') returning id", [c.id, cr.id, price, yearDate]);
    const p = await one("insert into payments (kind, ref_id, user_id, amount, b, status) values ('transport', 'x', $1, $2, $3, 'RELEASED') returning id", [client.id, price + 10, JSON.stringify({ transfer: price - 5 })]);
    const id = `LV-${yearDate.slice(0, 4)}-${price}`;
    await query(`insert into deliveries (id, cargo_id, offer_id, client_id, carrier_id, price, status, payment_id, history, created_at)
      values ($1,$2,$3,$4,$5,$6,'COMPLETED',$7,$8,$9)`, [id, c.id, o.id, client.id, cr.id, price, p.id, JSON.stringify([['SCHEDULED', `${yearDate}T10:00:00Z`], ['COMPLETED', `${yearDate}T18:00:00Z`]]), `${yearDate}T10:00:00Z`]);
    return id;
  }
  const t23 = await transport(cl, '2023-06-15', 1000);
  const t24 = await transport(cl, '2024-03-02', 2000);
  await transport(other, '2024-05-05', 3000);

  // Une location terminée en 2024.
  const tr = await one("insert into trailers (no, name, year, type, day, week, month) values ('R-9','[\"Ouverte\",\"Open\"]',2020,'open',4500,25000,75000) returning id");
  const bp = await one("insert into payments (kind, ref_id, user_id, amount, b, status, extra, refunded) values ('rental','RENT-2024-1',$1,9773,'{}','PAID',1500,500) returning id", [cl.id]);
  await query(`insert into bookings (id, trailer_id, client_id, start_date, end_date, days, price, tps, tvq, total, deposit, dep_mode, charge_now, status, payment_id)
    values ('RENT-2024-1',$1,$2,'2024-08-01','2024-08-02',1,8500,425,848,9773,20000,'auth',9773,'COMPLETED',$3)`, [tr.id, cl.id, bp.id]);

  const h = await history(cl, {});
  assert.deepEqual(h.years, [2024, 2023]);
  assert.equal(h.year, 2024);
  assert.deepEqual(h.items.map((i) => i.id).sort(), ['RENT-2024-1', t24].sort());
  assert.equal(h.items.find((i) => i.kind === 'rental').amount, 9773 + 1500 - 500);
  assert.equal(h.items.find((i) => i.id === t24).amount, 2010);
  assert.equal(h.items.find((i) => i.id === t24).with, 'Transport X');

  const h23 = await history(cl, { year: 2023 });
  assert.deepEqual(h23.items.map((i) => i.id), [t23]);

  const hc = await history(cr, { year: 2024 });
  assert.equal(hc.items.length, 2);
  assert.equal(hc.items.find((i) => i.id === t24).amount, 1995);

  const ha = await history(ad, { year: 2024 });
  assert.equal(ha.items.length, 3);

  // Après suppression du compte, l’historique de l’autre partie reste complet.
  await query("update users set deleted = true, name = '', company = '' where id = $1", [cr.id]);
  const after = await history(cl, { year: 2023 });
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].with, null);
});
