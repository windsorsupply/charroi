// Petits outils d’affichage et de calcul utilisés par plusieurs écrans.
import { city } from '@shared/geo.js';

export const pad = (n, w) => String(n).padStart(w, '0');
export const YEAR = new Date().getFullYear();
export const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
export function addDays(n, from) { const d = from ? new Date(from + 'T12:00') : new Date(); d.setDate(d.getDate() + n); return isoLocal(d); }
export const today = () => addDays(0);
export const toCents = (v) => Math.round(parseFloat(String(v).replace(',', '.')) * 100) || 0;
export const num = (v) => parseFloat(String(v ?? '').replace(',', '.'));

export function fmt(lang) {
  const loc = lang === 'en' ? 'en-CA' : 'fr-CA';
  return {
    loc,
    money: (c) => new Intl.NumberFormat(loc, { style: 'currency', currency: 'CAD' }).format((c || 0) / 100),
    dFmt: (s) => (s ? new Date(String(s).length === 10 ? s + 'T12:00' : s).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' }) : ''),
    dtFmt: (s) => (s ? new Date(s).toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''),
    fmtN: (n) => Number(n).toLocaleString(loc, { maximumFractionDigits: 1 }),
  };
}

// Masque courriels et numéros avant le choix d’un transporteur.
export const mask = (s, label) => String(s || '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, label).replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, label);

// Texte en deux langues : ["fr", "en"] ou chaîne simple.
export const loc2 = (v, lang) => (Array.isArray(v) ? v[lang === 'en' ? 1 : 0] || v[0] : v || '');

export const pkgsOf = (g) => (g.pkgs && g.pkgs.length ? g.pkgs : [{ l: g.l || '', w: g.w || '', h: g.h || '' }]);
export const pkgCount = (g) => Math.max(pkgsOf(g).length, parseInt(g.total) || 0, parseInt(g.count) || 0);
export function cuft(g, fmtN) {
  const f = { in: 1 / 12, ft: 1, cm: 1 / 30.48 }[g.unit || 'cm'];
  return fmtN(Math.round(pkgsOf(g).reduce((s, p) => s + num(p.l) * num(p.w) * num(p.h), 0) * f * f * f * 10) / 10);
}

export const carrierRating = (u) => (u && u.ratingN ? u.ratingSum / u.ratingN : 0);
export const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
export const routeStr = (c) => (c ? `${c.from.city} → ${c.to.city}` : '');
export const regionOf = (name) => (city(name) || [])[3];

// Plages réservées (sans noms) : conflit de dates et statut affiché d’une remorque.
export const conflict = (S, trId, start, end) => S.busy.find((b) => b.trailerId === trId && start < b.end && b.start < end);
export function trailerStatus(S, tr) {
  if (['MAINTENANCE', 'UNAVAILABLE'].includes(tr.status)) return tr.status;
  if (S.busy.some((b) => b.trailerId === tr.id && b.status === 'ACTIVE')) return 'RENTED';
  const d = today();
  if (S.busy.some((b) => b.trailerId === tr.id && b.status !== 'ACTIVE' && b.start <= d && d < b.end)) return 'RESERVED';
  return 'AVAILABLE';
}

export const ageOn = (dob, on) => { const b = new Date(dob + 'T12:00'), d = new Date(on + 'T12:00'); let a = d.getFullYear() - b.getFullYear(); if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) a--; return a; };

// Réduit une photo avant l’envoi (côté le plus long : 560 px, ou plus pour les documents).
export function compress(file, m = 560) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, m / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => res(null);
      img.src = r.result;
    };
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  });
}

export const CLS = { COMPLETED: 'ok', RELEASED: 'ok', CONFIRMED: 'ok', AVAILABLE: 'ok', ACCEPTED: 'ok', approved: 'ok', PAID: 'ok', CLOSED: 'ok', TRANSPORTER_SELECTED: 'ok', DISPUTED: 'bad', CANCELLED: 'bad', REFUNDED: 'bad', REJECTED: 'bad', rejected: 'bad', UNAVAILABLE: 'bad', MAINTENANCE: 'warn', PENDING: 'warn', pending: 'warn', CAPTURED: 'warn', RESERVED: 'warn', PARTIALLY_REFUNDED: 'warn', WITHDRAWN: '', DELIVERED: 'blue', IN_TRANSIT: 'blue', PICKED_UP: 'blue', ACTIVE: 'blue', RENTED: 'blue', OFFERS_RECEIVED: 'blue', PUBLISHED: 'blue', SCHEDULED: 'blue' };
