// Profil de la personne connectée, et profil public d’un transporteur.
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LANGS, makeT } from '@shared/i18n.js';
import { REGIONS } from '@shared/geo.js';
import { useStore } from '../store.jsx';
import { api, fileUrl } from '../lib/api.js';
import { carrierRating, loc2 } from '../lib/util.js';
import { notifVars } from '../lib/view.js';
import { Avatar, Stars, Verified, Zoom } from '../components/ui.jsx';
import { DocsTable } from './Dashboard.jsx';

const VOLK = { '1-5': 'vol_1_5', '6-10': 'vol_6_10', '10+': 'vol_10p' };

export function Profile() {
  const st = useStore();
  const { S, me, user, t, tf, dtFmt, lang, setLang, toast, act, signOut, theme, setTheme } = st;
  const nav = useNavigate();
  const rv = S.reviews.filter((r) => r.to === me.id);
  const ns = S.notifs.filter((x) => x.to === me.id || x.to === (S.me && S.me.id)).slice(0, 6);
  const logout = async () => { await signOut(); toast(t('loggedOut')); nav('/home'); };
  const del = () => {
    if (!window.confirm(t('confirmDelete'))) return;
    act(() => api.act('deleteAccount')).then(async () => { await signOut(); toast(t('accountDeleted')); nav('/home'); }).catch(() => {});
  };
  return <><h1 className="pt">{t('profileT')}</h1>
    <div className="two"><div className="stack">
      <div className="panel"><div className="who" style={{ marginBottom: 10 }}><Avatar u={me} size={56} /><h3 style={{ margin: 0 }}>{t('myInfo')}</h3></div>
        <dl className="kv"><dt>{t('colName')}</dt><dd>{me.name}</dd><dt>{t('colCompany')}</dt><dd>{me.company || ''}</dd><dt>{t('colCity')}</dt><dd>{me.city || ''}, QC</dd>
          {me.email && <><dt>{t('suEmail')}</dt><dd>{me.email}</dd></>}{me.phone && <><dt>{t('colPhone')}</dt><dd>{me.phone}</dd></>}{me.shipVolume && <><dt>{t('colVolume')}</dt><dd>{t(VOLK[me.shipVolume])}</dd></>}</dl>
        <div className="actions">{me.role !== 'admin' ? <><Link className="btn" to="/dash">{t('navDash')}</Link>{me.role === 'carrier' && <Link className="btn ghost" to={`/carrier/${me.id}`}>{t('publicProfile')}</Link>}</>
          : <Link className="btn" to="/admin">{t('navAdmin')}</Link>}<Link className="btn ghost" to="/history">🗂️ {t('navHistory')}</Link></div>
      </div>
      {me.role === 'carrier' && <div className="panel"><h3>{t('documents')} <Verified u={me} /></h3><DocsTable u={me} own /></div>}
      <div className="panel"><h3>{t('myReviews')}</h3>
        {me.role === 'carrier' && <p><Stars n={carrierRating(me)} /> {carrierRating(me).toFixed(1)} · {tf('reviewsN', { n: me.ratingN || 0 })}</p>}
        {rv.length ? rv.map((r) => <p key={r.id}><Stars n={r.stars} /> {user(r.from).name}<br />{r.text}</p>) : <p className="muted">{t('noReviews')}</p>}</div>
    </div><div className="stack">
      <div className="panel"><label style={{ marginTop: 0 }}>{t('theme')}</label>
        <div className="lang" style={{ display: 'inline-flex' }}>{[['auto', 'themeAuto'], ['light', 'themeLight'], ['dark', 'themeDark']].map(([k, l]) => <button key={k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{t(l)}</button>)}</div>
        {theme === 'auto' && <p className="hint">{t('themeAutoH')}</p>}</div>
      <div className="panel"><label style={{ marginTop: 0 }}>{t('language')}</label>
        <div className="lang" style={{ display: 'inline-flex' }}>{LANGS.map((l) => <button key={l} className={l === lang ? 'on' : ''} onClick={() => { setLang(l); toast(makeT(l).t('langSaved')); }}>{l === 'fr' ? 'Français' : 'English'}</button>)}</div></div>
      <div className="panel"><h3>{t('notifs')}</h3>{ns.length ? ns.map((x) => <Link key={x.id} className={`notif ${x.read ? '' : 'unread'}`} to={(x.link || '#/home').slice(1)}>{tf(x.key, notifVars(x.vars, st))}<small>{dtFmt(x.at)}</small></Link>)
        : <p className="muted">{t('noNotifs')}</p>}</div>
      <div className="panel"><p className="small"><Link to="/help">{t('footerHelp')}</Link> · <Link to="/terms">{t('footerTerms')}</Link> · <Link to="/privacy">{t('footerPrivacy')}</Link></p>
        <div className="actions" style={{ marginTop: 0 }}><button className="btn ghost sm" onClick={logout}>{t('logout')}</button><button className="btn danger sm" onClick={del}>{t('deleteAccount')}</button></div></div>
    </div></div>
  </>;
}

export function CarrierProfile() {
  const { id } = useParams();
  const { S, user, t, tf, lang, loc, openModal } = useStore();
  const cr = S.users[id];
  if (!cr || cr.role !== 'carrier') return <div className="empty">{t('notFound')}</div>;
  const rv = S.reviews.filter((r) => r.to === id);
  return <>
    <div className="panel">
      <div className="head" style={{ marginBottom: 8 }}><div className="who"><Avatar u={cr} size={64} /><div><h1 className="pt" style={{ margin: 0 }}>{cr.company}</h1><p className="muted" style={{ margin: 0 }}>{cr.name}, {cr.city} ({REGIONS[cr.region] || ''})</p></div></div><Verified u={cr} /></div>
      {cr.veh && cr.veh.photo && <img className="zoom" src={fileUrl(cr.veh.photo)} alt="" style={{ maxHeight: 200, borderRadius: 8, margin: '6px 0 10px' }} onClick={() => openModal(<Zoom src={fileUrl(cr.veh.photo)} />)} />}
      <p><Stars n={carrierRating(cr)} /> {carrierRating(cr).toFixed(1)} · {tf('reviewsN', { n: cr.ratingN || 0 })} · {tf('deliveriesN', { n: cr.deliveries || 0 })} · {tf('experience', { n: cr.exp || 0 })}</p>
      <p>{loc2(cr.desc, lang)}</p>
      <dl className="kv"><dt>{t('vehicle')}</dt><dd>{cr.vehicle ? t('vh_' + cr.vehicle) : ''}</dd><dt>{t('trailer')}</dt><dd>{t('tt_' + (cr.trailer || 'none'))}</dd>
        <dt>{t('capacity')}</dt><dd>{tf('capacityKg', { n: Number(cr.capacity || 0).toLocaleString(loc) })}</dd><dt>{t('documents')}</dt><dd>{cr.docsApproved || 0} {t('dst_approved').toLowerCase()}</dd></dl>
    </div>
    <div className="panel"><h2>{t('reviewsT')}</h2>{rv.length ? rv.map((r) => <p key={r.id}><Stars n={r.stars} /> {user(r.from).name}<br />{r.text}</p>) : <p className="muted">{t('noReviews')}</p>}</div>
  </>;
}
