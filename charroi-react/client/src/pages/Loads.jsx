// Cargaisons disponibles (transporteurs) : recherche « où allez-vous ? » et filtres.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { REGIONS, city, distKm } from '@shared/geo.js';
import { GOODS, VEH, SPECIAL } from '@shared/pricing.js';
import { addDays, today, num, toCents, pkgCount } from '../lib/util.js';
import { dims } from '../lib/view.js';
import { CityList, Opts, RouteLine } from '../components/ui.jsx';
import { fileUrl } from '../lib/api.js';

export function LoadCard({ c, near }) {
  const { S, me, t, tf, money, dFmt, fmtN } = useStore();
  const mine = S.offers.find((o) => o.cargoId === c.id && o.carrierId === me.id && o.status === 'PENDING');
  const ph = (c.goods.photos || [])[0];
  const left = Math.round((new Date(c.to.date + 'T12:00') - new Date(today() + 'T12:00')) / 864e5);
  const d = dims(c.goods, t, fmtN);
  return (
    <Link className={`load${ph ? ' withpic' : ''}`} to={`/cargo/${c.id}`}>
      {ph && <img className="lpic" src={fileUrl(ph)} alt="" />}
      <div>
        <RouteLine a={c.from.city} b={c.to.city} />
        {near && <div className="nearrow">
          {near.p <= 999 && <span className="near">📍 {tf('nearP', { k: fmtN(Math.round(near.p)) })}</span>}
          {near.d <= 999 && <span className="near">🏁 {tf('nearD', { k: fmtN(Math.round(near.d)) })}</span>}
        </div>}
        <div className="dates"><span>{tf('postedOn', { d: dFmt(c.createdAt) })}</span>
          <span className={`dl${left <= 1 ? ' urgent' : ''}`}>{tf('deliverBy', { d: dFmt(c.to.date) })}{left <= 1 ? ` · ${t('urgent')}` : ''}</span></div>
        <div className="meta">
          <span>{tf('pickupOn', { d: dFmt(c.from.date) })}</span><span>{tf('kmUnit', { n: c.km })}</span><span>{t('gt_' + c.goods.type)}</span>
          <span>{c.goods.weight} kg</span><span>{tf('pieces', { n: pkgCount(c.goods) })}</span>{d && <span>{d}</span>}<span>{t('vh_' + c.transport.vehicle)}</span>
          {SPECIAL.includes(c.transport.vehicle) && <span className="st warn">{t('special')}</span>}
        </div>
        <div className="row">
          <span className="price">{c.budget ? money(c.budget) : <span className="muted" style={{ fontSize: '1rem' }}>{t('quoteWanted')}</span>}</span>
          <span>{mine ? <span className="st ok">{tf('myOfferSent', { p: money(mine.price) })}</span> : <span className="st">{tf('offersN', { n: c.offersPending || 0 })}</span>}</span>
        </div>
      </div>
    </Link>
  );
}

export default function Loads() {
  const { S, me, t, tf, filters: f, setFilters, fmtN } = useStore();
  const [goIn, setGoIn] = useState(f.go || '');
  const [goErr, setGoErr] = useState('');
  const setF = (k, v) => setFilters({ ...f, [k]: v });
  const G = f.go && city(f.go) ? city(f.go)[0] : null;
  const rad = num(f.rad) > 0 ? num(f.rad) : 10, gm = f.gm || 'both';
  const near = (c) => ({ p: distKm(G, c.from.city), d: distKm(G, c.to.city) });
  const key = (c) => { const n = near(c); return gm === 'pickup' ? n.p : gm === 'drop' ? n.d : Math.min(n.p, n.d); };
  const wd = f.when === 'today' ? today() : f.when === 'tomorrow' ? addDays(1) : null;
  let list = S.cargos.filter((c) => ['PUBLISHED', 'OFFERS_RECEIVED'].includes(c.status))
    .filter((c) => (!wd || (c.from.date <= wd && c.to.date >= wd)) && (!G || key(c) <= rad) && (!f.from || c.from.city === f.from)
      && (!f.region || (city(c.from.city) || [])[3] === f.region) && (!f.maxKm || c.km <= num(f.maxKm)) && (!f.maxW || c.goods.weight <= num(f.maxW))
      && (!f.type || c.goods.type === f.type) && (!f.veh || c.transport.vehicle === f.veh) && (!f.before || c.from.date <= f.before)
      && (!f.minB || (c.budget || 0) >= toCents(f.minB)));
  const so = f.sort || (G ? 'near' : 'date');
  list = [...list].sort((a, b) => (so === 'near' && G ? key(a) - key(b) : so === 'budget' ? (b.budget || 0) - (a.budget || 0) : so === 'km' ? a.km - b.km : a.from.date.localeCompare(b.from.date)));

  const goSearch = () => {
    const v = goIn.trim();
    if (!v) { setFilters({ ...f, go: '' }); return; }
    const c = city(v);
    if (!c) { setGoErr(t('errCity')); return; }
    setGoErr(''); setGoIn(c[0]);
    setFilters({ ...f, go: c[0], sort: !f.sort || f.sort === 'date' ? 'near' : f.sort });
  };
  const sel = (k, lab, children) => <div><label htmlFor={`ff-${k}`}>{lab}</label><select id={`ff-${k}`} value={f[k] || ''} onChange={(e) => setF(k, e.target.value)}><option value="">{t('any')}</option>{children}</select></div>;
  const inp = (k, lab) => <div><label htmlFor={`ff-${k}`}>{lab}</label><input id={`ff-${k}`} type="number" min="0" inputMode="numeric" value={f[k] || ''} onChange={(e) => setF(k, e.target.value)} /></div>;

  return <>
    <section className="goto"><h2>🚚 {t('goT')}</h2><p className="muted" style={{ margin: '0 0 10px' }}>{t('goD')}</p>
      <label htmlFor="goCity" style={{ marginTop: 0 }}>{t('goWhere')}</label>
      <div className="gorow"><input id="goCity" list="qcCities" value={goIn} placeholder={t('cityPh')} autoComplete="off" onChange={(e) => setGoIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && goSearch()} />
        <button className="btn amber" onClick={goSearch}>{t('goBtn')}</button></div><CityList />
      {goErr && <div className="err" role="alert">{goErr}</div>}
      <div className="radrow"><span className="small"><b>{t('goRad')}</b></span>
        {[5, 10, 25, 50].map((k) => <button key={k} type="button" className={`chipbtn ${rad === k ? 'on' : ''}`} onClick={() => setF('rad', k)}>{k} km</button>)}
        <label className="small" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{t('goOther')} <input type="number" min="1" max="500" inputMode="numeric" defaultValue={[5, 10, 25, 50].includes(rad) ? '' : rad} style={{ width: 80, minHeight: 36 }} onChange={(e) => e.target.value && setF('rad', e.target.value)} /> km</label></div>
      <div className="radrow"><span className="small"><b>{t('goWhen')}</b></span>
        {[['all', 'whenAll'], ['today', 'whenToday'], ['tomorrow', 'whenTomorrow']].map(([k, l]) => <button key={k} type="button" className={`chipbtn ${(f.when || 'all') === k ? 'on' : ''}`} onClick={() => setF('when', k)}>{t(l)}</button>)}</div>
      <div className="radrow">{[['both', 'goBoth'], ['pickup', 'goPickup'], ['drop', 'goDrop']].map(([k, l]) => <button key={k} type="button" className={`chipbtn ${gm === k ? 'on' : ''}`} onClick={() => setF('gm', k)}>{t(l)}</button>)}</div>
      {G && <p className="gosum">{tf('goSum', { n: list.length, r: fmtN(rad), c: G })} <button className="linkbtn" onClick={() => { setGoIn(''); setF('go', ''); }}>{t('goClear')}</button></p>}
    </section>

    <div className="head"><h1 className="pt">{t('boardTitle')}</h1><span className="muted">{tf('loadsN', { n: list.length })}</span></div>
    {me.role === 'carrier' && !me.verified && <div className="note">{t('notVerified')}</div>}
    {me.role === 'guest' && <div className="info" style={{ marginBottom: 12 }}><b>🚛 {t('suCarrierT')}</b><p style={{ margin: '4px 0 8px' }}>{t('offerGateG')}</p>
      <Link className="btn sm" to="/signup/carrier">{t('suCarrierA')}</Link> <Link className="btn ghost sm" to="/login">{t('login')}</Link></div>}

    <details className="panel" style={{ padding: '12px 16px' }} open={window.innerWidth > 880}>
      <summary>{t('fRegion')}, {t('distance').toLowerCase()}, {t('fType').toLowerCase()}…</summary>
      <div className="grid3">
        <div><label htmlFor="ff-from">{t('fFrom')}</label><input id="ff-from" list="qcCities" defaultValue={f.from || ''} placeholder={t('any')} onBlur={(e) => setF('from', city(e.target.value) ? city(e.target.value)[0] : '')} /></div>
        {sel('region', t('fRegion'), Object.keys(REGIONS).map((r) => <option key={r} value={r}>{REGIONS[r]}</option>))}
        {sel('type', t('fType'), <Opts arr={GOODS} pre="gt_" />)}
        {inp('maxKm', t('fMaxKm'))}{inp('maxW', t('fMaxW'))}{inp('minB', t('fMinBudget'))}
        <div><label htmlFor="ff-before">{t('fBefore')}</label><input id="ff-before" type="date" value={f.before || ''} onChange={(e) => setF('before', e.target.value)} /></div>
        {sel('veh', t('fVehicle'), <Opts arr={VEH} pre="vh_" />)}
        <div><label htmlFor="ff-sort">{t('sort')}</label><select id="ff-sort" value={so} onChange={(e) => setF('sort', e.target.value)}>
          <option value="date">{t('sortDate')}</option><option value="budget">{t('sortBudget')}</option><option value="km">{t('sortKm')}</option>{G && <option value="near">{t('sortNear')}</option>}</select></div>
      </div>
      <div className="actions"><button className="btn ghost sm" onClick={() => { setFilters({}); setGoIn(''); }}>{t('clearF')}</button></div>
    </details>

    <div style={{ marginTop: 14 }}>{list.length ? list.map((c) => <LoadCard key={c.id} c={c} near={G ? near(c) : null} />)
      : <div className="empty">{G ? tf('goNone', { r: fmtN(rad), c: G }) : wd ? t('noLoadsWhen') : t('noLoads')}</div>}</div>
  </>;
}
