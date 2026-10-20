// Petits composants d’interface réutilisés dans les écrans.
import { useStore } from '../store.jsx';
import { CITIES, MAJOR, city } from '@shared/geo.js';
import { CLS, stars as starStr, carrierRating } from '../lib/util.js';
import { fileUrl } from '../lib/api.js';

export const Icon = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  msg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 5h16v11H9l-5 4z" /></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>,
};

// Étiquette de statut colorée (préfixe de traduction + statut).
export function Chip({ p, s }) {
  const { t } = useStore();
  return <span className={`st ${CLS[s] || ''}`}>{t(`${p}_${s}`)}</span>;
}

export const RouteLine = ({ a, b, big }) => (
  <div className={`route${big ? ' big' : ''}`}><span>{a}</span><span className="lane" aria-hidden="true" /><span>{b}</span></div>
);

// Tableau de montants ; lignes : [libellé, valeur, classe?] ; null ignoré.
export const SumRows = ({ rows, tot }) => (
  <table className="sum"><tbody>
    {rows.filter(Boolean).map((r, i) => <tr key={i} className={r[2] || ''}><td>{r[0]}</td><td>{r[1]}</td></tr>)}
    {tot && <tr className="tot"><td>{tot[0]}</td><td>{tot[1]}</td></tr>}
  </tbody></table>
);

export const Stars = ({ n }) => <span className="rating">{starStr(n)}</span>;

export function Rating({ u }) {
  const { tf } = useStore();
  const r = carrierRating(u);
  return <><Stars n={r} /> <span className="small muted">{r.toFixed(1)} · {tf('reviewsN', { n: u.ratingN || 0 })} · {tf('deliveriesN', { n: u.deliveries || 0 })}</span></>;
}

export function Avatar({ u, size = 40 }) {
  const { openModal } = useStore();
  if (u && u.photo) return <img className="avatar zoom" src={fileUrl(u.photo)} alt="" style={{ width: size, height: size }} onClick={() => openModal(<Zoom src={fileUrl(u.photo)} />)} />;
  const ini = ((u && u.name) || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar ini" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{ini}</span>;
}

export function Verified({ u }) {
  const { t } = useStore();
  return u && u.verified ? <span className="verif">✓ {t('verified')}</span> : null;
}

export function Zoom({ src }) {
  const { t, closeModal } = useStore();
  return <><img src={src} alt="" style={{ width: '100%', borderRadius: 8 }} /><div className="actions"><button className="btn ghost" onClick={closeModal}>{t('close')}</button></div></>;
}

export function Thumbs({ list }) {
  const { openModal } = useStore();
  if (!list || !list.length) return null;
  return <div className="thumbs">{list.map((p, i) => <img key={i} className="zoom" src={fileUrl(p)} alt="" onClick={() => openModal(<Zoom src={fileUrl(p)} />)} />)}</div>;
}

export function Tabs({ list, cur, onPick }) {
  const { t } = useStore();
  return <div className="tabs" role="tablist">{list.map(([k, l]) => <button key={k} role="tab" className={k === cur ? 'on' : ''} onClick={() => onPick(k)}>{t(l)}</button>)}</div>;
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;

// Liste des villes du Québec pour les champs avec suggestions.
const SORTED = CITIES.map((c) => c[0]).sort((a, b) => a.localeCompare(b, 'fr'));
export const CityList = () => <datalist id="qcCities">{SORTED.map((c) => <option key={c} value={c} />)}</datalist>;

export const Opts = ({ arr, pre }) => {
  const { t } = useStore();
  return arr.map((x) => <option key={x} value={x}>{t(pre + x)}</option>);
};

// ---------- Carte schématique du Québec ----------
const MB = { minLng: -79.6, maxLng: -67.8, minLat: 44.9, maxLat: 49 };
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const proj = (lat, lng) => [+clampN(10 + ((lng - MB.minLng) / (MB.maxLng - MB.minLng)) * 300, 8, 312).toFixed(1), +clampN(10 + ((MB.maxLat - lat) / (MB.maxLat - MB.minLat)) * 180, 8, 192).toFixed(1)];
const RIVER = [[45.05, -74.5], [45.45, -73.6], [45.95, -73.0], [46.3, -72.5], [46.8, -71.2], [47.3, -70.2], [48.0, -69.4], [48.5, -68.5], [49.0, -67.8]].map((p) => proj(p[0], p[1]).join(',')).join(' ');

function Pin({ p, label }) {
  const right = p[0] < 225;
  return <>
    <circle cx={p[0]} cy={p[1]} r="6" fill="var(--blue)" stroke="var(--surface)" strokeWidth="2" />
    <text x={right ? p[0] + 10 : p[0] - 10} y={p[1] + 4} textAnchor={right ? 'start' : 'end'} fontSize="12" fontWeight="700" fill="var(--ink)" fontFamily="Barlow, Arial, sans-serif">{label}</text>
  </>;
}

export function RouteMap({ a, b, anim }) {
  const A = city(a), B = city(b);
  let path = null;
  if (A && B) {
    const p1 = proj(A[1], A[2]), p2 = proj(B[1], B[2]);
    const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2 - Math.max(12, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 0.25);
    path = <>
      <path className="rt" d={`M${p1[0]} ${p1[1]} Q${mx.toFixed(1)} ${my.toFixed(1)} ${p2[0]} ${p2[1]}`} fill="none" stroke="var(--amber)" strokeWidth="3.5" strokeDasharray="8 6" strokeLinecap="round" />
      <Pin p={p1} label={A[0]} /><Pin p={p2} label={B[0]} />
    </>;
  }
  return (
    <svg viewBox="0 0 320 200" className={`map${anim ? ' anim' : ''}`} role="img" aria-label={a && b ? `${a} → ${b}` : 'Québec'}>
      <rect width="320" height="200" rx="10" fill="var(--soft)" />
      <polyline points={RIVER} fill="none" stroke="var(--river)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      {MAJOR.map((c) => { const p = proj(c[1], c[2]); return <circle key={c[0]} cx={p[0]} cy={p[1]} r="2.2" fill="var(--muted)" />; })}
      {path}
    </svg>
  );
}

// ---------- Dessin d’une remorque (quand il n’y a pas de photo) ----------
const BODY = {
  open: <><rect x="62" y="70" width="188" height="34" rx="2" fill="none" stroke="var(--tire)" strokeWidth="4" /><path d="M62 70V50h188v20M100 50v20M138 50v20M176 50v20M214 50v20" stroke="var(--tire)" strokeWidth="3" fill="none" /><rect x="62" y="96" width="188" height="8" fill="var(--amber)" /></>,
  enclosed: <><rect x="60" y="20" width="192" height="84" rx="7" fill="var(--blue)" /><rect x="74" y="34" width="60" height="9" rx="2" fill="#fff" opacity=".85" /><path d="M232 30v66" stroke="var(--on-blue)" strokeWidth="2" opacity=".5" /></>,
  flat: <><rect x="50" y="90" width="206" height="13" fill="var(--tire)" /><path d="M256 90l30 14h-30z" fill="var(--tire)" /><rect x="66" y="84" width="176" height="6" fill="var(--amber)" /></>,
  dump: <><path d="M62 104V56h168l22 48z" fill="var(--amber)" stroke="var(--tire)" strokeWidth="3" strokeLinejoin="round" /><path d="M62 104h190" stroke="var(--tire)" strokeWidth="4" /><path d="M80 70h120" stroke="var(--tire)" strokeWidth="2" opacity=".35" /></>,
};
export const TrailerSvg = ({ type }) => (
  <svg viewBox="0 0 300 140" className="trsvg" aria-hidden="true">
    <path d="M10 100h54" stroke="var(--tire)" strokeWidth="5" strokeLinecap="round" /><circle cx="10" cy="100" r="5" fill="var(--tire)" />
    {BODY[type]}
    <rect x="116" y="103" width="84" height="6" fill="var(--tire)" />
    <circle cx="138" cy="116" r="15" fill="var(--tire)" /><circle cx="138" cy="116" r="6" fill="var(--soft)" />
    <circle cx="178" cy="116" r="15" fill="var(--tire)" /><circle cx="178" cy="116" r="6" fill="var(--soft)" />
    <path d="M0 134h300" stroke="var(--line)" strokeWidth="2" strokeDasharray="14 10" />
  </svg>
);
export const TrailerPic = ({ tr }) => (tr.photos && tr.photos[0] ? <img src={fileUrl(tr.photos[0])} alt="" /> : <TrailerSvg type={tr.type} />);
