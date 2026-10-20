// Publication d’une cargaison en 6 étapes (départ, destination, marchandise, transport, prix, vérification).
// Le brouillon est gardé sur l’appareil ; on peut remplir les sections dans n’importe quel ordre.
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { city, km, hoursFor } from '@shared/geo.js';
import { GOODS, VEH, SPECIAL, POSTAL } from '@shared/pricing.js';
import { addDays, today, num, toCents, pkgsOf, pkgCount } from '../lib/util.js';
import { dimsList } from '../lib/view.js';
import { CityList, Opts, RouteLine, RouteMap, Thumbs } from '../components/ui.jsx';
import { PhotoBox } from '../components/media.jsx';

const STEPS = ['stepFrom', 'stepTo', 'stepGoods', 'stepTransport', 'stepPrice', 'stepReview'];

export const blankDraft = () => ({
  step: 1, seen: [],
  from: { city: 'Montréal', address: '', postal: '', date: addDays(3), time: '08:00', notes: '' },
  to: { city: 'Québec', address: '', postal: '', date: addDays(3), time: '16:00', notes: '' },
  goods: { type: 'pallets', desc: '', weight: '', pkgs: [{ l: '', w: '', h: '' }], total: '', unit: 'in', value: '', fragile: false, notes: '', photos: [] },
  transport: { vehicle: 'standard', trailer: 'none', capacity: '', loading: false, unloading: false },
  priceMode: 'quote', budget: '',
});

function validate(d, n, t, tf) {
  if (n <= 2) {
    const v = d[n === 1 ? 'from' : 'to'];
    if (!city(v.city)) return t('errCity');
    if (!v.address) return tf('errReq', { f: t('fAddress') });
    if (v.postal && !POSTAL.test(v.postal)) return t('errPostal');
    if (!v.date) return tf('errReq', { f: t('fDate') });
    if (v.date < today()) return t('errPast');
    if (n === 2) {
      if (d.to.city === d.from.city && d.to.address === d.from.address) return t('errSame');
      if (d.to.date < d.from.date) return t('errDateOrder');
    }
  }
  if (n === 3) {
    if (!d.goods.desc) return tf('errReq', { f: t('fDesc') });
    if (!(num(d.goods.weight) > 0)) return tf('errNum', { f: t('fWeight') });
    const P = pkgsOf(d.goods);
    for (let i = 0; i < P.length; i++) if (!(num(P[i].l) > 0 && num(P[i].w) > 0 && num(P[i].h) > 0)) return tf('errDimsN', { n: i + 1 });
    if (P.length === 3 && d.goods.total !== '' && d.goods.total != null && !(parseInt(d.goods.total) >= 4)) return t('errTotal');
  }
  if (n === 5 && d.priceMode === 'budget' && !(num(d.budget) > 0)) return tf('errNum', { f: t('fBudget') });
  return '';
}

export default function Publish() {
  const st = useStore();
  const { t, tf, draft, setDraft, act, toast, money, dFmt, fmtN } = st;
  const nav = useNavigate();
  const d = draft || blankDraft();
  const step = d.step;
  const save = (nd) => setDraft(nd);
  // Met à jour un champ du brouillon (chemin « goods.weight », etc.).
  const set = (path, v) => {
    const nd = structuredClone(d);
    const k = path.split('.');
    let x = nd;
    for (let i = 0; i < k.length - 1; i++) x = x[k[i]];
    x[k[k.length - 1]] = v;
    save(nd);
  };
  const go = (n) => { const nd = { ...d, step: n, seen: [...new Set([...(d.seen || []), step])] }; save(nd); window.scrollTo(0, 0); };
  const errs = [1, 2, 3, 4, 5].map((n) => [n, validate(d, n, t, tf)]).filter((x) => x[1]);
  const inp = (path, props = {}) => {
    const v = path.split('.').reduce((o, k) => o[k], d);
    return { value: v ?? '', onChange: (e) => set(path, e.target.value), ...props };
  };
  const fixCity = (path) => (e) => { const c = city(e.target.value); if (c) set(path, c[0]); };

  async function submit() {
    if (errs.length) { save({ ...d, seen: [1, 2, 3, 4, 5] }); toast(t('fixBefore')); return; }
    const g = d.goods;
    try {
      const id = await act(async () => {
        const photos = await api.uploadAll(g.photos);
        const c = {
          from: { ...d.from, postal: d.from.postal.toUpperCase() }, to: { ...d.to, postal: d.to.postal.toUpperCase() },
          goods: { type: g.type, desc: g.desc, pkgs: pkgsOf(g).map((p) => ({ l: num(p.l), w: num(p.w), h: num(p.h) })), count: Math.max(pkgsOf(g).length, parseInt(g.total) || 0), weight: num(g.weight), unit: g.unit || 'in', value: toCents(g.value || 0), fragile: !!g.fragile, notes: g.notes, photos },
          transport: { vehicle: d.transport.vehicle, capacity: num(d.transport.capacity) || num(g.weight), loading: !!d.transport.loading, unloading: !!d.transport.unloading },
          budget: d.priceMode === 'budget' ? toCents(d.budget) : null, km: km(d.from.city, d.to.city),
        };
        return api.act('publishCargo', { c });
      });
      setDraft(null);
      toast(t('published'));
      nav(`/cargo/${id}`);
    } catch (_) { /* message déjà affiché */ }
  }

  let body;
  if (step <= 2) {
    const p = step === 1 ? 'from' : 'to';
    body = <>
      <h2>{t(STEPS[step - 1])}</h2>
      <div className="grid2">
        <div><label htmlFor="f1">{t('fCity')}</label><input id="f1" list="qcCities" autoComplete="off" placeholder={t('cityPh')} {...inp(`${p}.city`)} onBlur={fixCity(`${p}.city`)} /><CityList /></div>
        <div><label htmlFor="f0">{t('fProvince')}</label><input id="f0" value="Québec" disabled /></div>
      </div>
      <label htmlFor="f2">{t('fAddress')}</label><input id="f2" autoComplete="street-address" placeholder={t('addrPh')} {...inp(`${p}.address`)} />
      <div className="grid3">
        <div><label htmlFor="f3">{t('fPostal')}</label><input id="f3" placeholder={t('postalPh')} maxLength={7} autoCapitalize="characters" {...inp(`${p}.postal`)} /></div>
        <div><label htmlFor="f4">{t(step === 1 ? 'fPickupDate' : 'fDeadline')}</label><input id="f4" type="date" min={today()} {...inp(`${p}.date`)} /></div>
        <div><label htmlFor="f5">{t('fTime')}</label><input id="f5" type="time" {...inp(`${p}.time`)} /></div>
      </div>
      <label htmlFor="f6">{t('fNotes')}</label><textarea id="f6" rows={2} {...inp(`${p}.notes`)} />
    </>;
  } else if (step === 3) {
    const g = d.goods, P = pkgsOf(g);
    const setPkgs = (pk) => set('goods.pkgs', pk);
    body = <>
      <h2>{t('stepGoods')}</h2>
      <div className="grid2">
        <div><label htmlFor="g1">{t('fType')}</label><select id="g1" {...inp('goods.type')}><Opts arr={GOODS} pre="gt_" /></select></div>
        <div><label htmlFor="g4">{t('fWeight')}</label><input id="g4" type="number" min="1" inputMode="decimal" {...inp('goods.weight')} /></div>
      </div>
      <label htmlFor="g3">{t('fDesc')}</label><textarea id="g3" rows={2} {...inp('goods.desc')} />
      <PhotoBox list={g.photos} onChange={(ph) => set('goods.photos', ph)} />
      <label htmlFor="g8">{t('fValue')}</label><input id="g8" type="number" min="0" inputMode="decimal" {...inp('goods.value')} />
      <fieldset className="dims"><legend>{t('fDimsT')} *</legend>
        <p className="small muted" style={{ margin: '0 0 4px' }}>{t('dimsHelp')}</p>
        <div style={{ maxWidth: 220 }}><label htmlFor="gu">{t('fUnit')}</label><select id="gu" {...inp('goods.unit')}>{['in', 'ft'].map((x) => <option key={x} value={x}>{t('unit_' + x)}</option>)}</select></div>
        {P.map((pk, i) => (
          <div className="pkg" key={i}>
            <div className="pkghead"><b>{tf('pkgN', { n: i + 1 })}</b>{i > 0 && <button type="button" className="btn ghost sm" onClick={() => setPkgs(P.filter((_, j) => j !== i))}>✕ {t('removePkg')}</button>}</div>
            <div className="grid3 keep">{[['l', 'fL'], ['w', 'fW'], ['h', 'fH']].map(([k, lab]) => (
              <div key={k}><label htmlFor={`pk${i}${k}`}>{t(lab)}</label><input id={`pk${i}${k}`} type="number" min="0" step="0.5" inputMode="decimal" value={pk[k] ?? ''}
                onChange={(e) => setPkgs(P.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></div>))}</div>
          </div>))}
        {P.length < 3
          ? <button type="button" className="btn ghost" style={{ marginTop: 12 }} onClick={() => setPkgs([...P, { l: '', w: '', h: '' }])}>+ {t(P.length === 1 ? 'addPkg2' : 'addPkg3')}</button>
          : <div className="more"><label htmlFor="gt">{t('morePkgs')}</label><input id="gt" type="number" min="4" step="1" inputMode="numeric" placeholder="4, 5, 6…" style={{ maxWidth: 160 }} {...inp('goods.total')} /><p className="small" style={{ margin: '8px 0 0' }}>📞 {t('morePkgsNote')}</p></div>}
      </fieldset>
      <label className="chk"><input type="checkbox" checked={!!g.fragile} onChange={(e) => set('goods.fragile', e.target.checked)} />{t('fFragile')}</label>
      <label htmlFor="g9">{t('fSpecial')}</label><textarea id="g9" rows={2} {...inp('goods.notes')} />
    </>;
  } else if (step === 4) {
    const x = d.transport;
    body = <>
      <h2>{t('stepTransport')}</h2>
      <label htmlFor="t1">{t('fVehicle')}</label><select id="t1" {...inp('transport.vehicle')}><Opts arr={VEH} pre="vh_" /></select>
      {SPECIAL.includes(x.vehicle) && <div className="special"><b>⚠️ {t('special')}</b><p style={{ margin: '4px 0 0' }}>{t('specialNote')}</p></div>}
      <div className="info"><b>ℹ️ {t('vehNoteT')}</b><p style={{ margin: '4px 0 0' }}>{t('vehNote')}</p></div>
      <label htmlFor="t3">{t('fCapacity')}</label><input id="t3" type="number" min="0" inputMode="numeric" value={x.capacity || d.goods.weight || ''} onChange={(e) => set('transport.capacity', e.target.value)} />
      <label className="chk"><input type="checkbox" checked={!!x.loading} onChange={(e) => set('transport.loading', e.target.checked)} />{t('fLoading')}</label>
      <label className="chk"><input type="checkbox" checked={!!x.unloading} onChange={(e) => set('transport.unloading', e.target.checked)} />{t('fUnloading')}</label>
    </>;
  } else if (step === 5) {
    body = <>
      <h2>{t('stepPrice')}</h2><p className="muted">{t('fPriceMode')}</p>
      <div className="radio">{[['quote', 'pmQuote'], ['budget', 'pmBudget']].map(([v, l]) => (
        <label key={v}><input type="radio" name="pm" checked={d.priceMode === v} onChange={() => set('priceMode', v)} />{t(l)}</label>))}</div>
      {d.priceMode === 'budget' && <><label htmlFor="p1">{t('fBudget')}</label><input id="p1" type="number" min="1" inputMode="decimal" {...inp('budget')} /></>}
    </>;
  } else {
    const k = km(d.from.city, d.to.city), g = d.goods;
    body = <>
      <h2>{t('stepReview')}</h2>
      {errs.length ? <div className="missing"><b>{t('toComplete')}</b><ul>{errs.map(([n, e]) => <li key={n}><button type="button" className="linkbtn" onClick={() => go(n)}>{t(STEPS[n - 1])}</button> : {e}</li>)}</ul></div>
        : <p className="st ok" style={{ marginBottom: 10 }}>✓ {t('allGood')}</p>}
      <div className="two"><div>
        <RouteLine a={d.from.city} b={d.to.city} big />
        <p className="muted" style={{ marginTop: 8 }}>{t('distance')} : {tf('kmUnit', { n: k })} · {t('duration')} : {tf('hUnit', { n: hoursFor(k) })}</p>
        <dl className="kv">
          <dt>{t('pickup')}</dt><dd>{d.from.address}, {d.from.city} {d.from.postal}<br />{dFmt(d.from.date)} {d.from.time}</dd>
          <dt>{t('dropoff')}</dt><dd>{d.to.address}, {d.to.city} {d.to.postal}<br />{dFmt(d.to.date)} {d.to.time}</dd>
          <dt>{t('goods')}</dt><dd>{t('gt_' + g.type)}, {g.weight} kg, {tf('pieces', { n: pkgCount(g) })}{g.fragile ? ', ' + t('fragile') : ''}</dd>
          <dt>{t('specDims')}</dt><dd>{dimsList(g, t, tf, fmtN).map((l, i) => <div key={i}>{l}</div>)}</dd>
          <dt>{t('vehicle')}</dt><dd>{t('vh_' + d.transport.vehicle)}{SPECIAL.includes(d.transport.vehicle) && <><br /><span className="st warn">{t('special')}</span></>}</dd>
          <dt>{t('stepPrice')}</dt><dd>{d.priceMode === 'budget' ? money(toCents(d.budget)) : t('quoteWanted')}</dd>
        </dl>
        <Thumbs list={g.photos} />
      </div><div><RouteMap a={d.from.city} b={d.to.city} /></div></div>
    </>;
  }

  return <>
    <h1 className="pt">{t('pubTitle')}</h1>
    <p className="small muted" style={{ margin: '-4px 0 8px' }}>{t('freeNav')}</p>
    <ol className="steps">{STEPS.map((k, i) => {
      const n = i + 1, seen = (d.seen || []).includes(n), bad = n < 6 && !!validate(d, n, t, tf);
      const ok = n < 6 && seen && !bad, miss = n < 6 && seen && bad && n !== step;
      return <li key={k} className={n === step ? 'on' : ok ? 'done' : miss ? 'miss' : ''}><button type="button" onClick={() => go(n)} aria-current={n === step ? 'step' : undefined}>
        <span>{ok && n !== step ? '✓' : miss ? '!' : n}</span>{t(k)}</button></li>;
    })}</ol>
    <div className="panel">
      {body}
      <div className="actions">
        {step > 1 && <button className="btn ghost" onClick={() => go(step - 1)}>{t('back')}</button>}
        {step < 6 ? <button className="btn" onClick={() => go(step + 1)}>{t('next')}</button> : <button className="btn amber" onClick={submit}>{t('publish')}</button>}
      </div>
    </div>
  </>;
}
