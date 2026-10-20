// Calculs de prix, partagés par le serveur (qui fait foi) et l’app (affichage).
// Tous les montants sont en cents (CAD).

export const DEFAULT_SETTINGS = {
  commission: 4, serviceFee: 0, tps: 5, tvq: 9.975, autoConfirmH: 48,
  stripePct: 2.9, stripeFixed: 30, payoutPct: 0.25, payoutFixed: 25,
  depositAuthMaxDays: 5, freeCancelH: 48, minAge: 21, subPrice: 5999, subThreshold: 50000,
};

const r = Math.round;

// Prix d’un transport : taxes du transporteur (s’il est inscrit), commission et frais.
export function calcTransport(price, taxReg, s) {
  const comm = r((price * s.commission) / 100);
  const commTps = r((comm * s.tps) / 100), commTvq = r((comm * s.tvq) / 100);
  const cTps = taxReg ? r((price * s.tps) / 100) : 0, cTvq = taxReg ? r((price * s.tvq) / 100) : 0;
  const fee = r((price * s.serviceFee) / 100);
  const feeTax = fee ? r((fee * s.tps) / 100) + r((fee * s.tvq) / 100) : 0;
  const total = price + cTps + cTvq + fee + feeTax;
  const transfer = price + cTps + cTvq - comm - commTps - commTvq;
  const stripe = r((total * s.stripePct) / 100) + s.stripeFixed;
  const payout = r((transfer * s.payoutPct) / 100) + s.payoutFixed;
  return { price, rate: s.commission, comm, commTps, commTvq, cTps, cTvq, fee, feeTax, total, transfer, stripe, payout, margin: comm + fee - stripe - payout };
}

// Meilleure combinaison mois / semaines / jours.
export function rentalPrice(tr, days) {
  let best = Infinity;
  for (let m = 0; m <= Math.ceil(days / 30); m++) {
    const rest = Math.max(0, days - 30 * m);
    for (let w = 0; w <= Math.ceil(rest / 7); w++) {
      const d = Math.max(0, rest - 7 * w);
      best = Math.min(best, m * tr.month + w * tr.week + d * tr.day);
    }
  }
  return best;
}

export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);

// Location : dépôt en autorisation sur la carte (courte durée) ou prélevé puis remboursé.
export function calcRental(tr, start, end, s) {
  const days = Math.max(1, daysBetween(start, end));
  const price = rentalPrice(tr, days);
  const tps = r((price * s.tps) / 100), tvq = r((price * s.tvq) / 100);
  const total = price + tps + tvq;
  const depMode = days <= s.depositAuthMaxDays ? 'auth' : 'capture';
  return { days, price, tps, tvq, total, deposit: tr.deposit, depMode, chargeNow: total + (depMode === 'capture' ? tr.deposit : 0) };
}

// Annulation par le client : gratuite jusqu’à freeCancelH heures avant le début, sinon 50 % retenu.
export function cancelRefund(b, paid, refunded, s, now = new Date()) {
  const hrs = (new Date(b.start + 'T07:00:00-04:00') - now) / 3600e3;
  const keep = hrs >= s.freeCancelH ? 0 : r(b.price * 0.5);
  const refund = paid - refunded - keep - (keep ? r((keep * (s.tps + s.tvq)) / 100) : 0);
  return { keep, refund: Math.max(0, refund) };
}

export const GOODS = ['pallets', 'furniture', 'machinery', 'materials', 'food', 'vehicle', 'other'];
export const VEH = ['standard', 'pickup', 'cube', 'enclosed', 'flat10', 'flat24', 'flat36'];
export const SPECIAL = ['flat24', 'flat36'];
export const TRT = ['open', 'enclosed', 'flat', 'dump'];
export const DFLOW = ['SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED', 'COMPLETED'];
export const POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
