// Aides d’affichage qui dépendent des données (conversations, livraisons, textes traduits).
import { loc2, pkgsOf, pkgCount, routeStr } from './util.js';
import { L } from '@shared/i18n.js';

// Variables des notifications : montants et dates arrivent bruts du serveur.
export function notifVars(v, { money, dFmt }) {
  const o = { ...(v || {}) };
  if (typeof o.p === 'number') o.p = money(o.p);
  if (typeof o.d === 'string' && /^\d{4}-\d\d-\d\d/.test(o.d)) o.d = dFmt(o.d.slice(0, 10));
  return o;
}

export const myConvs = (S, me) => S.convs.filter((c) => me.role === 'admin' || c.members.includes(me.id));
export const cargoOf = (S, d) => S.cargos.find((c) => c.id === d.cargoId);
export const payOf = (S, id) => S.payments.find((p) => p.id === id);
export const trName = (tr, lang) => (tr ? loc2(tr.name, lang) : '');

export function convTitle(S, c, t, lang) {
  if (c.kind === 'pre') { const g = S.cargos.find((x) => x.id === c.refId); return `${c.refId}${g ? ' · ' + routeStr(g) : ''} · ${t('special')}`; }
  if (c.kind === 'transport') { const d = S.deliveries.find((x) => x.id === c.refId); const g = d && cargoOf(S, d); return c.refId + (g ? ' · ' + routeStr(g) : ''); }
  const b = S.bookings.find((x) => x.id === c.refId);
  return c.refId + (b ? ' · ' + trName(S.trailers.find((x) => x.id === b.trailerId), lang) : '');
}

export function convOther(S, c, me, user, t) {
  if (me.role === 'admin') return c.members.filter((m) => m !== 'admin').map((m) => user(m).name).join(', ');
  const o = c.members.find((m) => m !== me.id);
  return o === 'admin' ? t('company') : user(o).company || user(o).name;
}

// Décision d’un litige : clé de traduction, ou « resPartial:<cents> ».
export function resText(r, t, money) {
  r = String(r || '');
  if (r.startsWith('resPartial:')) return `${t('resPartial')} (${money(parseInt(r.split(':')[1]))})`;
  return L[r] ? t(r) : r;
}

export const inspResult = (x, t, tf, money) => (x.fees
  ? tf('depositKept', { a: money(x.kept || 0) }) + (x.extra ? '. ' + tf('extraCharged', { a: money(x.extra) }) : '')
  : t('depositReleased'));

// Dimensions des colis.
export function dims(g, t, fmtN) {
  const P = pkgsOf(g).filter((p) => parseFloat(p.l) > 0);
  if (!P.length) return '';
  const u = g.unit || 'cm';
  return `${fmtN(P[0].l)} × ${fmtN(P[0].w)} × ${fmtN(P[0].h)} ${t('unitShort_' + u)}` + (pkgCount(g) > 1 ? ` +${pkgCount(g) - 1}` : '');
}
export function dimsList(g, t, tf, fmtN) {
  const P = pkgsOf(g).filter((p) => parseFloat(p.l) > 0);
  const u = g.unit || 'cm';
  const extra = pkgCount(g) - P.length;
  const lines = P.map((p, i) => `${P.length > 1 || extra > 0 ? tf('pkgN', { n: i + 1 }) + ' : ' : ''}${fmtN(p.l)} × ${fmtN(p.w)} × ${fmtN(p.h)} ${t('unitShort_' + u)}`);
  if (extra > 0) lines.push(tf('otherPkgs', { n: extra }));
  return lines;
}
