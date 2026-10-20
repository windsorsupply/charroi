// Comptes : connexion, mot de passe oublié, choix du type de compte, inscription client / transporteur.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { REGIONS, city } from '@shared/geo.js';
import { VEH, POSTAL, EMAIL } from '@shared/pricing.js';
import { today, num, compress } from '../lib/util.js';
import { CityList } from '../components/ui.jsx';

export function Login() {
  const { t, tf, signIn, next, setNext, toast, errMsg, setBusy } = useStore();
  const nav = useNavigate();
  const [em, setEm] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState('');
  const go = async () => {
    if (!em.trim() || !pw) return setErr(t('errLogin'));
    setBusy(true);
    try {
      const r = await api.auth('login', { email: em.trim().toLowerCase(), password: pw });
      const d = await signIn(r.token);
      const u = d.me;
      toast(tf('welcome', { n: (u.name || '').split(' ')[0] }));
      const nx = next; setNext(null);
      nav(nx || (u.role === 'admin' ? '/admin' : u.role === 'carrier' ? '/dash' : '/home'));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const forgot = async () => {
    if (!EMAIL.test(em.trim())) return setErr(t('forgotEmail'));
    try { await api.auth('forgot', { email: em.trim() }); toast(t('forgotSentReal')); } catch (e) { toast(errMsg(e)); }
  };
  return <div className="authbox"><h1 className="pt">{t('login')}</h1>
    <div className="panel">
      <label htmlFor="li1">{t('suEmail')}</label><input id="li1" type="email" autoComplete="email" inputMode="email" value={em} onChange={(e) => setEm(e.target.value)} />
      <label htmlFor="li2">{t('suPwd')}</label><input id="li2" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="actions"><button className="btn full" onClick={go}>{t('login')}</button></div>
      <p className="small" style={{ margin: '12px 0 0' }}><button className="linkbtn" onClick={forgot}>{t('forgot')}</button></p>
    </div>
    <p style={{ marginTop: 16, textAlign: 'center' }}>{t('noAccount')} <Link to="/signup"><b>{t('signup')}</b></Link></p>
    <p className="small" style={{ textAlign: 'center' }}>🛻 {t('gateRent')} <Link to="/trailers">{t('c3a')}</Link></p>
  </div>;
}

export function Reset() {
  const { t, toast, errMsg } = useStore();
  const [q] = useSearchParams();
  const nav = useNavigate();
  const [a, setA] = useState(''), [b, setB] = useState(''), [err, setErr] = useState('');
  const save = async () => {
    if (a.length < 8) return setErr(t('errPwd'));
    if (a !== b) return setErr(t('errPwd2'));
    try { await api.auth('reset', { token: q.get('token') || '', password: a }); toast(t('pwdUpdated')); nav('/login'); } catch (e) { setErr(errMsg(e)); }
  };
  return <div className="authbox"><h1 className="pt">{t('resetT')}</h1><div className="panel">
    <label htmlFor="np1">{t('suPwd')}</label><input id="np1" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} />
    <label htmlFor="np2">{t('suPwd2')}</label><input id="np2" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
    {err && <div className="err" role="alert">{err}</div>}
    <div className="actions"><button className="btn full" onClick={save}>{t('save')}</button></div>
  </div></div>;
}

export function SignupChoice() {
  const { t } = useStore();
  return <div className="authbox wide"><h1 className="pt">{t('signupT')}</h1><p className="muted">{t('signupSub')}</p>
    <div className="choices two-col">
      <Link className="choice primary" to="/signup/client"><span className="ic" aria-hidden="true">🚚</span><h2>{t('suClientT')}</h2><p>{t('suClientD')}</p><span className="go">{t('suClientA')} →</span></Link>
      <Link className="choice" to="/signup/carrier"><span className="ic" aria-hidden="true">🚛</span><h2>{t('suCarrierT')}</h2><p>{t('suCarrierD')}</p><span className="go">{t('suCarrierA')} →</span></Link>
    </div>
    <div className="info" style={{ marginTop: 16 }}><b>🛻 {t('guestRentT')}</b><p style={{ margin: '4px 0 8px' }}>{t('guestRentD')}</p><Link className="btn ghost sm" to="/trailers">{t('c3a')}</Link></div>
    <p style={{ marginTop: 16, textAlign: 'center' }}>{t('haveAccount')} <Link to="/login"><b>{t('login')}</b></Link></p>
  </div>;
}

// ---------- Définition des formulaires d’inscription ----------
const isBiz = (v) => v.kind === 'business';
function forms(type) {
  const acct = [
    { k: 'firstName', l: 'suFirst', type: 'text', req: 1, ac: 'given-name', half: 1 }, { k: 'lastName', l: 'suLast', type: 'text', req: 1, ac: 'family-name', half: 1 },
    { k: 'email', l: 'suEmail', type: 'email', req: 1, ac: 'email' }, { k: 'phone', l: 'suPhone', type: 'tel', req: 1, ac: 'tel', h: 'suPhoneH' },
    { k: 'password', l: 'suPwd', type: 'password', req: 1, ac: 'new-password', h: 'suPwdH', half: 1 }, { k: 'password2', l: 'suPwd2', type: 'password', req: 1, ac: 'new-password', half: 1 },
    { k: 'lang', l: 'suLang', type: 'select', req: 1, opts: [['fr', 'Français'], ['en', 'English']] }];
  const consent = (extra) => ({ t: 'suConsentT', f: [
    { k: 'terms', l: type === 'carrier' ? 'suTermsC' : 'suTerms', type: 'check', req: 1 }, { k: 'privacy', l: 'suPrivacy', type: 'check', req: 1 }, ...extra,
    { k: 'marketing', l: 'suMarketing', type: 'check' }] });
  if (type === 'client') return [
    { t: 'suProfileT', f: [{ k: 'photo', l: 'suPhotoC', type: 'photo', h: 'suPhotoCH', avatar: 1 },
      { k: 'kind', l: 'suKind', type: 'radio', req: 1, opts: [['person', 'suPerson'], ['business', 'suBusiness']] }, ...acct.slice(0, 2),
      { k: 'company', l: 'suCompany', type: 'text', req: 1, when: isBiz, ac: 'organization' }, { k: 'neq', l: 'suNeqOpt', type: 'text', when: isBiz, h: 'suNeqH' }, ...acct.slice(2)] },
    { t: 'suNeedsT', f: [{ k: 'volume', l: 'suVolume', type: 'radio', req: 1, opts: [['1-5', 'vol_1_5'], ['6-10', 'vol_6_10'], ['10+', 'vol_10p']], h: 'suVolumeH' }] },
    { t: 'suAddrT', f: [{ k: 'city', l: 'fCity', type: 'city', req: 1 }, { k: 'address', l: 'suAddrOpt', type: 'text', ac: 'street-address', h: 'suAddrH' }, { k: 'postal', l: 'suPostalOpt', type: 'text', ac: 'postal-code' }] },
    consent([])];
  return [
    { t: 'suProfileT', f: [{ k: 'photo', l: 'suPhotoT', type: 'photo', req: 1, h: 'suPhotoTH', avatar: 1 }, ...acct] },
    { t: 'suBizT', f: [{ k: 'status', l: 'suStatus', type: 'radio', req: 1, opts: [['self', 'suSelf'], ['inc', 'suInc']] },
      { k: 'company', l: 'suTradeName', type: 'text', req: (v) => v.status === 'inc', ac: 'organization', h: 'suTradeNameH' }, { k: 'neq', l: 'suNeq', type: 'text', req: (v) => v.status === 'inc', h: 'suNeqH' },
      { k: 'address', l: 'suBizAddr', type: 'text', req: 1, ac: 'street-address' }, { k: 'city', l: 'fCity', type: 'city', req: 1, half: 1 }, { k: 'postal', l: 'fPostal', type: 'text', req: 1, ac: 'postal-code', half: 1 },
      { k: 'regions', l: 'suRegions', type: 'checks', req: 1, opts: Object.entries(REGIONS), raw: 1, h: 'suRegionsH' }, { k: 'exp', l: 'suExp', type: 'number', req: 1, min: 0 }] },
    { t: 'suVehT', f: [{ k: 'vehicle', l: 'suVehType', type: 'select', req: 1, opts: VEH.map((v) => [v, 'vh_' + v]) },
      { k: 'make', l: 'suMake', type: 'text', req: 1, half: 1 }, { k: 'model', l: 'suModel', type: 'text', req: 1, half: 1 }, { k: 'year', l: 'fYear', type: 'number', req: 1, min: 1980, half: 1 }, { k: 'plate', l: 'suPlate', type: 'text', req: 1, half: 1 },
      { k: 'capacity', l: 'suCap', type: 'number', req: 1, min: 1, half: 1 }, { k: 'length', l: 'suLen', type: 'number', req: 1, min: 1, half: 1 },
      { k: 'liftgate', l: 'suLift', type: 'check' }, { k: 'equip', l: 'suEquip', type: 'checks', opts: [['straps', 'eq_straps'], ['blankets', 'eq_blankets'], ['dolly', 'eq_dolly'], ['palletjack', 'eq_palletjack'], ['ramps', 'eq_ramps']] },
      { k: 'vehPhoto', l: 'suVehPhoto', type: 'photo', h: 'suVehPhotoH' }] },
    { t: 'suDocsT', f: [{ k: 'docsIntro', l: 'suDocsIntro', type: 'note' }, { k: 'idvNote', l: 'idvAfterSignup', type: 'note' },
      { k: 'licClass', l: 'suLicClass', type: 'select', req: 1, half: 1, opts: [['5', 'lic5'], ['3', 'lic3'], ['1', 'lic1']] }, { k: 'licExp', l: 'suLicExp', type: 'date', req: 1, future: 1, half: 1 },
      { k: 'regPhoto', l: 'suRegPhoto', type: 'photo', req: 1, doc: 1 },
      { k: 'heavy', l: 'suHeavy', type: 'check', h: 'suHeavyH' }, { k: 'nir', l: 'suNir', type: 'text', req: 1, when: (v) => v.heavy, h: 'suNirH' },
      { k: 'insurer', l: 'suInsurer', type: 'text', req: 1, half: 1 }, { k: 'policy', l: 'suPolicy', type: 'text', req: 1, half: 1 }, { k: 'insExp', l: 'suInsExp', type: 'date', req: 1, future: 1, half: 1 }, { k: 'cargoAmt', l: 'suCargoAmt', type: 'number', req: 1, min: 1, half: 1 },
      { k: 'insPhoto', l: 'suInsPhoto', type: 'photo', req: 1, doc: 1 },
      { k: 'taxReg', l: 'suTax', type: 'radio', req: 1, opts: [['yes', 'suTaxYes'], ['no', 'suTaxNo']] }, { k: 'tps', l: 'suTps', type: 'text', req: 1, when: (v) => v.taxReg === 'yes', half: 1 }, { k: 'tvq', l: 'suTvq', type: 'text', req: 1, when: (v) => v.taxReg === 'yes', half: 1 },
      { k: 'payNote', l: 'suPayNote', type: 'note' }] },
    consent([{ k: 'subscr', l: 'suSubAccept', type: 'check', req: 1 }, { k: 'attest', l: 'suAttest', type: 'check', req: 1 }])];
}
const isReq = (f, v) => (typeof f.req === 'function' ? f.req(v) : !!f.req);

function validate(type, v, t, tf) {
  const errs = [];
  for (const s of forms(type)) for (const f of s.f) {
    if (f.type === 'note' || (f.when && !f.when(v))) continue;
    const x = v[f.k];
    const empty = x == null || x === '' || x === false || (Array.isArray(x) && !x.length);
    if (isReq(f, v) && empty) { errs.push([f.k, f.type === 'photo' ? tf('errPhotoReq', { f: t(f.l) }) : f.type === 'check' ? t('errConsent') : tf('errReq', { f: t(f.l) })]); continue; }
    if (empty) continue;
    if (f.type === 'email' && !EMAIL.test(x)) errs.push([f.k, t('errEmail')]);
    if (f.type === 'tel' && String(x).replace(/\D/g, '').length < 10) errs.push([f.k, t('errPhone')]);
    if (f.k === 'password' && x.length < 8) errs.push([f.k, t('errPwd')]);
    if (f.k === 'password2' && x !== v.password) errs.push([f.k, t('errPwd2')]);
    if (f.k === 'postal' && !POSTAL.test(x)) errs.push([f.k, t('errPostal')]);
    if (f.k === 'neq' && !/^\d{10}$/.test(String(x).replace(/\s/g, ''))) errs.push([f.k, t('errNeq')]);
    if (f.type === 'city' && !city(x)) errs.push([f.k, t('errCity')]);
    if (f.type === 'date' && f.future && x <= today()) errs.push([f.k, tf('errExpired', { f: t(f.l) })]);
    if (f.type === 'number' && !(num(x) >= (f.min || 0))) errs.push([f.k, tf('errNum', { f: t(f.l) })]);
  }
  return errs;
}

export function Signup({ type }) {
  const st = useStore();
  const { S, t, tf, lang, signIn, next, setNext, toast, errMsg, setBusy, openModal, closeModal, money } = st;
  const nav = useNavigate();
  const [v, setV] = useState(type === 'client' ? { kind: 'person', lang } : { status: 'self', lang });
  const [showErr, setShowErr] = useState(false);
  const errs = showErr ? validate(type, v, t, tf) : [];
  const bad = new Set(errs.map((e) => e[0]));
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const lbl = (k) => (st.t(k) !== k ? t(k) : k);
  const subPrice = S.settings.subPrice ?? 5999, subThreshold = S.settings.subThreshold ?? 50000;

  const field = (f) => {
    if (f.when && !f.when(v)) return null;
    const x = v[f.k], id = 'su-' + f.k, cls = `sufield${bad.has(f.k) ? ' bad' : ''}`;
    const req = isReq(f, v) ? <> <span className="req">*</span></> : null;
    const hint = f.h ? <p className="hint">{t(f.h)}</p> : null;
    if (f.type === 'note') return <div key={f.k} className="info small" style={{ marginTop: 12 }}>{t(f.l)}</div>;
    if (f.type === 'photo') {
      const pick = async (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) { const d = await compress(file, f.avatar ? 560 : 1400); if (d) set(f.k, d); } };
      return <div key={f.k} className={cls} id={id}><span className="flabel">{t(f.l)}{req}</span><div className="photorow">
        {x ? <img className={f.avatar ? 'avatar' : 'docimg'} src={x} alt="" /> : f.avatar ? <span className="avatar ini empty" aria-hidden="true">👤</span> : null}
        <label className={`btn ${x ? 'ghost' : ''} sm`}>📷 {x ? t('changePhoto') : t('addPhoto')}<input className="vh" type="file" accept="image/*" onChange={pick} /></label></div>{hint}</div>;
    }
    if (f.type === 'radio') return <div key={f.k} className={cls} id={id}><span className="flabel">{t(f.l)}{req}</span><div className="radio">
      {f.opts.map((o) => <label key={o[0]}><input type="radio" name={id} checked={x === o[0]} onChange={() => set(f.k, o[0])} />{lbl(o[1])}</label>)}</div>{hint}</div>;
    if (f.type === 'check') return <div key={f.k} className={cls} id={id}><label className="chk"><input type="checkbox" checked={!!x} onChange={(e) => set(f.k, e.target.checked)} /><span>{f.k === 'subscr' ? tf(f.l, { p: money(subPrice), s: money(subThreshold) }) : t(f.l)}{req}</span></label>{hint}</div>;
    if (f.type === 'checks') return <div key={f.k} className={cls} id={id}><span className="flabel">{t(f.l)}{req}</span><div className="checks">
      {f.opts.map((o) => <label key={o[0]} className="chk"><input type="checkbox" checked={(x || []).includes(o[0])} onChange={(e) => { const s = new Set(x || []); e.target.checked ? s.add(o[0]) : s.delete(o[0]); set(f.k, [...s]); }} />{f.raw ? o[1] : lbl(o[1])}</label>)}</div>{hint}</div>;
    const common = { id, value: x || '', autoComplete: f.ac, onChange: (e) => set(f.k, e.target.value) };
    let ctl;
    if (f.type === 'select') ctl = <select {...common}><option value="">{t('choose')}</option>{f.opts.map((o) => <option key={o[0]} value={o[0]}>{lbl(o[1])}</option>)}</select>;
    else if (f.type === 'city') ctl = <><input {...common} list="qcCities" onBlur={(e) => { const c = city(e.target.value); if (c) set(f.k, c[0]); }} /><CityList /></>;
    else ctl = <input {...common} type={f.type} min={f.min} inputMode={f.type === 'number' ? 'decimal' : f.type === 'tel' ? 'tel' : undefined} {...(f.type === 'date' && f.future ? { min: today() } : {})} />;
    return <div key={f.k} className={cls}><label htmlFor={id}>{t(f.l)}{req}</label>{ctl}{hint}</div>;
  };
  const section = (s) => {
    const out = []; let buf = [];
    const flush = () => { if (buf.length) { out.push(<div className="grid2" key={'g' + out.length}>{buf}</div>); buf = []; } };
    s.f.forEach((f) => { const x = field(f); if (!x) return; if (f.half) buf.push(x); else { flush(); out.push(x); } });
    flush();
    return <fieldset key={s.t} className="susec"><legend>{t(s.t)}</legend>{out}</fieldset>;
  };

  const submit = async () => {
    const e = validate(type, v, t, tf);
    if (e.length) { setShowErr(true); window.scrollTo(0, 0); return; }
    const ci = city(v.city);
    const meta = { role: type, firstName: v.firstName, lastName: v.lastName, phone: v.phone, lang: v.lang || lang, city: ci ? ci[0] : v.city, address: v.address || '', postal: (v.postal || '').toUpperCase(), marketing: !!v.marketing };
    if (type === 'client') Object.assign(meta, { kind: v.kind, volume: v.volume, company: isBiz(v) ? v.company : '', neq: v.neq || '' });
    else Object.assign(meta, { company: (v.company || '').trim(), status: v.status, neq: v.neq || '', region: (v.regions || [])[0] || (ci ? ci[3] : ''), regions: v.regions || [], exp: v.exp,
      vehicle: v.vehicle, capacity: v.capacity, make: v.make, model: v.model, year: v.year, plate: v.plate, length: v.length, liftgate: !!v.liftgate, equip: v.equip || [],
      licClass: v.licClass, licExp: v.licExp, heavy: !!v.heavy, nir: v.heavy ? v.nir : '', insurer: v.insurer, policy: v.policy, insExp: v.insExp, cargoAmt: v.cargoAmt, taxReg: v.taxReg, tps: v.tps || '', tvq: v.tvq || '' });
    setBusy(true);
    try {
      const r = await api.auth('signup', { email: v.email.trim().toLowerCase(), password: v.password, meta });
      await signIn(r.token);
      // Photos envoyées une fois le compte créé (profil, véhicule, documents privés).
      try {
        const up = {};
        if (v.photo) up.photo = await api.upload(v.photo);
        if (v.vehPhoto) up.vehPhoto = await api.upload(v.vehPhoto);
        if (v.regPhoto) up.regPhoto = await api.upload(v.regPhoto, { priv: true, docs: true });
        if (v.insPhoto) up.insPhoto = await api.upload(v.insPhoto, { priv: true, docs: true });
        if (Object.keys(up).length) await api.act('setSignupPhotos', up);
      } catch (e2) { console.warn('photos', e2); }
      await st.refresh();
      st.setLang(meta.lang);
      toast(tf('welcome', { n: v.firstName }));
      const nx = next; setNext(null);
      nav(type === 'carrier' ? '/dash/docs' : nx || '/publish');
    } catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  };

  return <div className="authbox wide">
    <p style={{ margin: '0 0 6px' }}><Link to="/signup">← {t('back')}</Link></p>
    <h1 className="pt">{t(type === 'client' ? 'suClientT' : 'suCarrierT')}</h1><p className="muted">{t(type === 'client' ? 'suClientIntro' : 'suCarrierIntro')}</p>
    {type === 'carrier' && <div className="subbox"><h2>💰 {tf('subT', { p: money(subPrice) })}</h2><p>{tf('subD', { p: money(subPrice), s: money(subThreshold) })} <strong>{t('subFree')}</strong></p><p className="punch">{t('subPunch')}</p></div>}
    <p className="small muted">{t('reqLegend')}</p>
    {errs.length > 0 && <div className="missing" role="alert"><b>{t('suFix')}</b><ul>{errs.map(([k, e]) => <li key={k}><button type="button" className="linkbtn" onClick={() => { const el = document.getElementById('su-' + k); if (el) { el.scrollIntoView({ block: 'center' }); el.focus && el.focus(); } }}>{e}</button></li>)}</ul></div>}
    {forms(type).map(section)}
    <div className="actions"><button className="btn amber full" onClick={submit}>{t(type === 'client' ? 'suCreateC' : 'suCreateT')}</button></div>
    {type === 'carrier' && <p className="small muted" style={{ textAlign: 'center' }}>{t('suAfterT')}</p>}
    <p style={{ textAlign: 'center', marginTop: 12 }}>{t('haveAccount')} <Link to="/login"><b>{t('login')}</b></Link></p>
  </div>;
}
