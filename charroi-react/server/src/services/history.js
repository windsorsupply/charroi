// Historique : transports et locations terminés ou annulés, année par année.
// Lu directement dans la base (aucune limite de durée) : rien n’est jamais effacé,
// même à la suppression d’un compte (le profil est anonymisé, les transactions restent).
import { many } from '../db.js';
import { need, int } from './common.js';

const TZ = 'America/Toronto';

// Date de fin d’un transport : dernière étape de son historique.
const TRANSPORTS = `
  select d.id, d.status, d.client_id, d.carrier_id, d.cargo_id, d.price, d.pickup_date,
    coalesce((select max((h->>1)::timestamptz) from jsonb_array_elements(d.history) h), d.created_at) as ended_at,
    c.from_city, c.to_city, c.goods->>'type' as goods_type, c.goods->>'weight' as weight,
    p.amount, p.refunded, p.b, p.status as pay_status,
    cl.name as client_name, cl.company as client_company, cl.deleted as client_deleted,
    cr.name as carrier_name, cr.company as carrier_company, cr.deleted as carrier_deleted
  from deliveries d
  join cargos c on c.id = d.cargo_id
  join payments p on p.id = d.payment_id
  join users cl on cl.id = d.client_id
  join users cr on cr.id = d.carrier_id
  where d.status in ('COMPLETED','CANCELLED')`;

const RENTALS = `
  select b.id, b.status, b.client_id, b.trailer_id, b.start_date, b.end_date, b.days, b.price, b.renter, b.at,
    t.name as tname, t.no as tno, p.amount, p.extra, p.refunded, p.status as pay_status,
    cl.name as client_name, cl.deleted as client_deleted
  from bookings b
  join trailers t on t.id = b.trailer_id
  join payments p on p.id = b.payment_id
  join users cl on cl.id = b.client_id
  where b.status in ('COMPLETED','CANCELLED')`;

export async function history(u, { year }) {
  need(u, 'client', 'carrier', 'admin', 'guest');
  const admin = u.role === 'admin';
  const mineT = admin ? '' : ' and (d.client_id = $1 or d.carrier_id = $1)';
  const mineR = admin ? '' : ' and b.client_id = $1';
  const base = admin ? [] : [u.id];

  // Années où la personne a de l’activité terminée.
  const yT = await many(`select distinct extract(year from x.ended_at at time zone '${TZ}')::int as y from (${TRANSPORTS}${mineT}) x`, base);
  const yR = await many(`select distinct extract(year from x.end_date)::int as y from (${RENTALS}${mineR}) x`, base);
  const years = [...new Set([...yT, ...yR].map((r) => r.y))].sort((a, b) => b - a);
  const y = int(year) || years[0] || new Date().getFullYear();
  const n = base.length + 1;

  const tr = await many(`select * from (${TRANSPORTS}${mineT}) x where extract(year from x.ended_at at time zone '${TZ}') = $${n} order by x.ended_at desc`, [...base, y]);
  const re = await many(`select * from (${RENTALS}${mineR}) x where extract(year from x.end_date) = $${n} order by x.end_date desc`, [...base, y]);

  const who = (name, company, deleted) => (deleted ? null : company || name || '');
  const items = [
    ...tr.map((d) => {
      const role = admin ? 'admin' : d.client_id === u.id ? 'client' : 'carrier';
      const cancelled = d.status === 'CANCELLED';
      // Client : ce qu’il a payé (moins remboursements). Transporteur : ce qu’il a reçu. Admin : volume encaissé.
      const amount = role === 'carrier' ? (cancelled ? 0 : d.b.transfer) : d.amount - d.refunded;
      return {
        kind: 'transport', id: d.id, status: d.status, date: new Date(d.ended_at).toISOString(), pickup: d.pickup_date, role,
        from: d.from_city, to: d.to_city, goodsType: d.goods_type, weight: Number(d.weight) || null, cargoId: d.cargo_id,
        with: role === 'client' ? who(d.carrier_name, d.carrier_company, d.carrier_deleted)
          : role === 'carrier' ? who(d.client_name, '', d.client_deleted)
            : `${who(d.client_name, '', d.client_deleted) ?? '—'} → ${who(d.carrier_name, d.carrier_company, d.carrier_deleted) ?? '—'}`,
        amount, refunded: d.refunded, payStatus: d.pay_status,
      };
    }),
    ...re.map((b) => ({
      kind: 'rental', id: b.id, status: b.status, date: b.end_date, start: b.start_date, end: b.end_date, days: b.days, role: admin ? 'admin' : 'client',
      trailer: b.tname, trailerNo: b.tno, trailerId: b.trailer_id,
      with: admin ? (b.client_deleted ? null : b.client_name || (b.renter && b.renter.name) || '') : undefined,
      amount: b.amount + (b.extra || 0) - b.refunded, refunded: b.refunded, payStatus: b.pay_status,
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return { years, year: y, items };
}
