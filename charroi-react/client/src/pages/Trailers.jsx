// Remorques de l’entreprise : catalogue, fiche, réservation (identité, paiement), gestion par l’admin.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { calcRental, TRT, EMAIL } from '@shared/pricing.js';
import { addDays, today, toCents, num, loc2, conflict, trailerStatus, ageOn, YEAR } from '../lib/util.js';
import { trName } from '../lib/view.js';
import { Chip, Opts, SumRows, Thumbs, TrailerPic } from '../components/ui.jsx';
import { PhotoInput } from '../components/media.jsx';
import { openExternal, native } from '../native.js';
import PayModal from '../components/PayModal.jsx';

export function Trailers() {
  const { S, me, t, money, lang, loc, openModal } = useStore();
  return <>
    <div className="head"><div><h1 className="pt">{t('trTitle')}</h1><p className="muted" style={{ margin: 0 }}>{t('trSub')}</p></div>
      {me.role === 'admin' && <button className="btn" onClick={() => openModal(<TrailerModal />)}>{t('addTrailer')}</button>}</div>
    {!S.trailers.length && <div className="empty">{t('noTrailers')}{me.role === 'admin' && <><br />{t('noTrailersAdmin')}</>}</div>}
    <div className="trgrid">{S.trailers.map((tr) => (
      <Link key={tr.id} className="trcard" to={`/trailer/${tr.id}`}>
        <div className="pic"><TrailerPic tr={tr} /></div>
        <div className="body">
          <div className="head" style={{ margin: 0, alignItems: 'center' }}><h3>{trName(tr, lang)}</h3><Chip p="ts" s={trailerStatus(S, tr)} /></div>
          <span className="muted small">{tr.lf} × {tr.wf} {t('ftShort')} · {Number(tr.cap).toLocaleString(loc)} kg · {tr.hitch}</span>
          <span className="price" style={{ marginTop: 'auto' }}>{money(tr.day)} <span className="small muted">{t('perDay')}</span></span>
        </div>
      </Link>))}</div>
  </>;
}

export function TrailerModal({ tr }) {
  const { S, t, tf, lang, act, closeModal } = useStore();
  // Nouvelle remorque : champs vides (aucune valeur inventée) ; les conditions de la dernière remorque sont reprises si elles existent.
  const base = tr || { no: '', name: ['', ''], brand: '', model: '', year: YEAR, type: 'open', lf: '', wf: '', cap: '', wt: '', hitch: '', day: '', week: '', month: '', deposit: '', desc: ['', ''], cond: (S.trailers[S.trailers.length - 1] || {}).cond || ['', ''], photos: [] };
  const [f, setF] = useState({ ...base, name: loc2(base.name, lang), desc: loc2(base.desc, lang), cond: loc2(base.cond, lang), day: base.day === '' ? '' : base.day / 100, week: base.week === '' ? '' : base.week / 100, month: base.month === '' ? '' : base.month / 100, deposit: base.deposit === '' ? '' : base.deposit / 100 });
  const [photos, setPhotos] = useState(base.photos || []);
  const [err, setErr] = useState('');
  const ch = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const field = (k, lab, type) => <div><label htmlFor={`tm-${k}`}>{lab}</label><input id={`tm-${k}`} type={type || 'text'} inputMode={type ? 'decimal' : undefined} value={f[k]} onChange={ch(k)} /></div>;
  // Garde l’autre langue : on ne remplace que la langue affichée.
  const setL = (old, v) => { const a = Array.isArray(old) ? [...old] : [old || '', old || '']; a[lang === 'en' ? 1 : 0] = v; if (!a[0]) a[0] = v; if (!a[1]) a[1] = v; return a; };
  const save = () => {
    if (!f.no || !f.name) return setErr(tf('errReq', { f: t('fName') }));
    if (!(toCents(f.day) > 0)) return setErr(tf('errNum', { f: t('fDay') }));
    const p = { id: tr ? tr.id : '', no: f.no, name: setL(base.name, f.name), brand: f.brand, model: f.model, year: parseInt(f.year) || YEAR, type: f.type, lf: num(f.lf) || 0, wf: num(f.wf) || 0, cap: num(f.cap) || 0, wt: num(f.wt) || 0, hitch: f.hitch, day: toCents(f.day), week: toCents(f.week) || toCents(f.day) * 6, month: toCents(f.month) || toCents(f.day) * 22, deposit: toCents(f.deposit), desc: setL(base.desc, f.desc), cond: setL(base.cond, f.cond) };
    act(async () => { p.photos = await api.uploadAll(photos); return api.act('saveTrailer', { p }); }, t('trSaved')).then(closeModal, () => {});
  };
  return <>
    <h2>{tr ? trName(tr, lang) : t('addTrailer')}</h2>
    <div className="grid2">
      {field('no', t('fNumber'))}{field('name', t('fName'))}{field('brand', t('fBrand'))}{field('model', t('fModel'))}{field('year', t('fYear'), 'number')}
      <div><label htmlFor="tm-type">{t('fTrType')}</label><select id="tm-type" value={f.type} onChange={ch('type')}><Opts arr={TRT} pre="tt_" /></select></div>
      {field('lf', t('fLenFt'), 'number')}{field('wf', t('fWidFt'), 'number')}{field('cap', t('fCapKg'), 'number')}{field('wt', t('fWeightKg'), 'number')}{field('hitch', t('fHitch'))}
      {field('day', t('fDay'), 'number')}{field('week', t('fWeek'), 'number')}{field('month', t('fMonth'), 'number')}{field('deposit', t('fDeposit'), 'number')}
    </div>
    <label htmlFor="tm-desc">{t('fTrDesc')}</label><textarea id="tm-desc" rows={2} value={f.desc} onChange={ch('desc')} />
    <label htmlFor="tm-cond">{t('fConditions')}</label><textarea id="tm-cond" rows={2} value={f.cond} onChange={ch('cond')} />
    <label htmlFor="tm-ph">{t('fPhotos')}</label><PhotoInput id="tm-ph" list={photos} onChange={setPhotos} />
    {err && <div className="err" role="alert">{err}</div>}
    <div className="actions"><button className="btn ghost" onClick={closeModal}>{t('cancel')}</button><button className="btn" onClick={save}>{t('save')}</button></div>
  </>;
}

// Vérification d’identité (Stripe Identity) : page sécurisée de Stripe, puis retour dans l’app.
export function IdvBlock({ ctx }) {
  const { S, me, t, tf, dFmt, act, setBusy, toast, errMsg, signIn, refresh } = useStore();
  const idv = me.idv;
  const start = async () => {
    setBusy(true);
    try {
      // Visiteur : session « invité » créée d’abord.
      if (!S.me) { const g = await api.auth('guest'); await signIn(g.token); }
      const r = await api.act('identity', { web: !native });
      try { localStorage.setItem('charroi-back', window.location.hash.slice(1)); } catch (_) { /* ignoré */ }
      await refresh();
      await openExternal(r.url.startsWith('http') ? r.url : window.location.origin + r.url);
    } catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  };
  if (idv && idv.status === 'verified') return <span className="idvok">✓ {tf('idvDone', { d: dFmt(idv.at) })}</span>;
  if (idv && idv.status === 'pending') return <><p className="small">{t('idvPendingT')}</p>
    <button type="button" className="btn ghost sm" onClick={() => act(() => api.act('identityStatus')).catch(() => {})}>{t('idvCheck')}</button> <button type="button" className="btn sm" onClick={start}>🛡️ {t('idvBtn')}</button></>;
  return <>{idv && idv.status === 'failed' && <p className="err">{t('idvFailedT')}</p>}
    <button type="button" className="btn sm" onClick={start}>🛡️ {t('idvBtn')}</button>{ctx === 'booking' && <p className="hint">{t('idvBookH')}</p>}</>;
}

function BookForm({ tr }) {
  const { S, me, t, tf, money, dFmt, lang, openModal, setNext } = useStore();
  const [s, setS] = useState(addDays(1)), [e, setE] = useState(addDays(2));
  const [r, setR] = useState({ name: me.name || '', dob: '', email: me.email || '', phone: me.phone || '' });
  const [acc, setAcc] = useState(false), [err, setErr] = useState('');
  const minAge = S.settings.minAge || 21;
  let q = null, check = '';
  if (['MAINTENANCE', 'UNAVAILABLE'].includes(tr.status)) check = t('bMaint');
  else if (!s || !e) check = tf('errReq', { f: t('fDate') });
  else if (s < today()) check = t('bPast');
  else if (e <= s) check = t('bDateErr');
  else { const cf = conflict(S, tr.id, s, e); if (cf) check = tf('bUnavailable', { a: dFmt(cf.start), b: dFmt(cf.end) }); else q = calcRental(tr, s, e, S.settings); }
  const verified = me.idv && me.idv.status === 'verified';
  const ch = (k) => (ev) => setR({ ...r, [k]: ev.target.value });

  const book = () => {
    if (me.role === 'admin') return setErr(t('bRoleErr'));
    if (check) return setErr(check);
    if (r.name.trim().split(/\s+/).length < 2) return setErr(t('errFullName'));
    if (!r.dob) return setErr(tf('errReq', { f: t('renterDob') }));
    if (ageOn(r.dob, s) < minAge) return setErr(tf('errAge', { a: minAge }));
    if (me.role === 'guest') {
      if (!EMAIL.test(r.email.trim())) return setErr(t('errEmail'));
      if (r.phone.replace(/\D/g, '').length < 10) return setErr(t('errPhone'));
    }
    if (!verified) return setErr(t('idvBookErr'));
    if (!acc) return setErr(t('bAcceptErr'));
    setErr('');
    const renter = { name: r.name.trim(), dob: r.dob, email: r.email.trim(), phone: r.phone.trim() };
    openModal(<PayModal kind="booking" amount={q.chargeNow} intent={() => api.act('rentalIntent', { trailerId: tr.id, start: s, end: e, renter })} summary={<>
      <p><b>{trName(tr, lang)}</b><br />{dFmt(s)} → {dFmt(e)}<br /><span className="small muted">{t('driver')} : {renter.name}, {t('renterDob').toLowerCase()} {dFmt(renter.dob)}</span></p>
      <SumRows rows={[[t('bRental'), money(q.price)], ['TPS', money(q.tps)], ['TVQ', money(q.tvq)], q.depMode === 'capture' ? [t('deposit'), money(q.deposit)] : null]} tot={[t('bChargeNow'), money(q.chargeNow)]} />
      {q.depMode === 'auth' && <p className="small muted">{t('bDepositAuth')} : {money(q.deposit)}</p>}
    </>} />);
  };

  return <div className="panel"><h2>{t('bookT')}</h2>
    <div className="grid2 keep" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div><label htmlFor="bs">{t('bStart')}</label><input id="bs" type="date" min={today()} value={s} onChange={(ev) => setS(ev.target.value)} /></div>
      <div><label htmlFor="be">{t('bEnd')}</label><input id="be" type="date" min={addDays(1)} value={e} onChange={(ev) => setE(ev.target.value)} /></div>
    </div>
    <div style={{ marginTop: 12 }}>{check ? <div className="note bad">{check}</div> : <>
      <p className="st ok" style={{ marginBottom: 8 }}>✓ {t('bAvailable')}</p>
      <SumRows rows={[[`${t('bRental')} (${tf('bDays', { n: q.days })})`, money(q.price)], [tf('taxTps', { r: S.settings.tps }), money(q.tps)], [tf('taxTvq', { r: String(S.settings.tvq).replace('.', lang === 'fr' ? ',' : '.') }), money(q.tvq)], [q.depMode === 'auth' ? t('bDepositAuth') : t('bDepositCap'), money(q.deposit)]]} tot={[t('bChargeNow'), money(q.chargeNow)]} />
    </>}</div>
    {me.role === 'guest' && !S.me && <div className="info" style={{ marginTop: 12 }}><b>{t('guestRentT')}</b><p style={{ margin: '4px 0 0' }}>{t('guestRentD')} <Link to="/login" onClick={() => setNext(`/trailer/${tr.id}`)}>{t('login')}</Link></p></div>}
    {me.role !== 'admin' && <fieldset className="dims"><legend>🪪 {t('renterT')}</legend>
      <label htmlFor="bname">{t('renterName')} *</label><input id="bname" autoComplete="name" value={r.name} onChange={ch('name')} />
      <label htmlFor="bdob">{t('renterDob')} *</label><input id="bdob" type="date" autoComplete="bday" max={today()} value={r.dob} onChange={ch('dob')} />
      {me.role === 'guest' && <div className="grid2">
        <div><label htmlFor="bemail">{t('suEmail')} *</label><input id="bemail" type="email" autoComplete="email" inputMode="email" value={r.email} onChange={ch('email')} /></div>
        <div><label htmlFor="bphone">{t('suPhone')} *</label><input id="bphone" type="tel" autoComplete="tel" inputMode="tel" value={r.phone} onChange={ch('phone')} /></div>
      </div>}
      <div className="idvbook"><span className="flabel">🛡️ {t('idvBookT')} <span className="req">*</span></span><IdvBlock ctx="booking" /></div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>{tf('renterNote', { a: minAge })}</p>
    </fieldset>}
    <label className="chk"><input type="checkbox" checked={acc} onChange={(ev) => setAcc(ev.target.checked)} />{t('bAccept')}</label>
    {err && <div className="err" role="alert">{err}</div>}
    <button className="btn amber full" style={{ marginTop: 10 }} disabled={!!check} onClick={book}>{t('bBtn')}</button>
  </div>;
}

export function Trailer() {
  const { id } = useParams();
  const { S, me, t, tf, money, dFmt, lang, loc, act, openModal } = useStore();
  const tr = S.trailers.find((x) => x.id === id);
  if (!tr) return <div className="empty">{t('notFound')}</div>;
  const up = S.busy.filter((b) => b.trailerId === id && b.end >= today()).sort((a, b) => a.start.localeCompare(b.start));
  return <>
    <div className="head"><div><p className="muted" style={{ margin: 0 }}>{tr.no}</p><h1 className="pt" style={{ margin: 0 }}>{trName(tr, lang)}</h1></div><Chip p="ts" s={trailerStatus(S, tr)} /></div>
    <div className="two"><div className="stack">
      <div className="bigpic"><TrailerPic tr={tr} /></div>
      {tr.photos && tr.photos.length > 1 && <Thumbs list={tr.photos.slice(1)} />}
      <div className="panel"><p>{loc2(tr.desc, lang)}</p><h3>{t('specs')}</h3><dl className="kv">
        <dt>{t('specNo')}</dt><dd>{tr.no}</dd><dt>{t('specBrand')}</dt><dd>{tr.brand}</dd><dt>{t('specModel')}</dt><dd>{tr.model}</dd><dt>{t('specYear')}</dt><dd>{tr.year}</dd>
        <dt>{t('specType')}</dt><dd>{t('tt_' + tr.type)}</dd><dt>{t('specDims')}</dt><dd>{tr.lf} × {tr.wf} {t('ftShort')}</dd>
        <dt>{t('specCap')}</dt><dd>{Number(tr.cap).toLocaleString(loc)} kg</dd><dt>{t('specWeight')}</dt><dd>{Number(tr.wt).toLocaleString(loc)} kg</dd><dt>{t('specHitch')}</dt><dd>{tr.hitch}</dd>
      </dl></div>
      <div className="panel"><h3>{t('conditions')}</h3><p className="small">{loc2(tr.cond, lang)}</p><p className="small muted">{tf('cancelPolicy', { h: S.settings.freeCancelH })}</p></div>
      {me.role === 'admin' && <div className="panel"><label htmlFor="trs">{t('colStatus')}</label>
        <select id="trs" value={tr.status} onChange={(e) => act(() => api.act('setTrailerStatus', { trailerId: tr.id, status: e.target.value }), t('statusUpdated')).catch(() => {})}>
          {['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE'].map((s) => <option key={s} value={s}>{t('ts_' + s)}</option>)}</select>
        <div className="actions"><button className="btn ghost sm" onClick={() => openModal(<TrailerModal tr={tr} />)}>{t('save')}…</button></div></div>}
    </div><div className="stack">
      <div className="panel"><h3>{t('rates')}</h3><SumRows rows={[[t('perDay').replace('/ ', ''), money(tr.day)], [t('perWeek').replace('/ ', ''), money(tr.week)], [t('perMonth').replace('/ ', ''), money(tr.month)], [t('deposit'), money(tr.deposit)]]} /></div>
      <BookForm tr={tr} />
      <div className="panel"><h3>{t('bBooked')}</h3>{up.length ? up.map((b, i) => <p key={i} style={{ margin: '4px 0' }}>{dFmt(b.start)} → {dFmt(b.end)}</p>) : <p className="muted">{t('bNone')}</p>}</div>
    </div></div>
  </>;
}
