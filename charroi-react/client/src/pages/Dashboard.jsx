// Tableau de bord : client (transport, location, paiements) et transporteur (livraisons, offres, revenus, documents).
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api, fileUrl } from '../lib/api.js';
import { compress, routeStr, CLS } from '../lib/util.js';
import { cargoOf, payOf, trName } from '../lib/view.js';
import { Chip, RouteLine, Tabs, Zoom } from '../components/ui.jsx';
import { IdvBlock } from './Trailers.jsx';
import { openExternal, native } from '../native.js';

function DelivRow({ d }) {
  const { S, me, user, money, dFmt } = useStore();
  const c = cargoOf(S, d), p = payOf(S, d.paymentId);
  if (!c || !p) return null;
  const mineCarrier = me.id === d.carrierId;
  return <Link className="load" to={`/delivery/${d.id}`}><RouteLine a={c.from.city} b={c.to.city} />
    <div className="meta"><span>{d.id}</span><span>{dFmt(d.pickupDate || c.from.date)}</span><span>{mineCarrier ? user(d.clientId).name : user(d.carrierId).company}</span></div>
    <div className="row"><span className="price">{money(mineCarrier ? p.b.transfer : p.amount)}</span><Chip p="ds" s={d.status} /></div></Link>;
}

export function PayTable({ list }) {
  const { t, money, dFmt } = useStore();
  if (!list.length) return <div className="empty">{t('emptyPay')}</div>;
  return <div className="tbl"><table><thead><tr><th>{t('colDate')}</th><th>{t('colRef')}</th><th>{t('colType')}</th><th className="num">{t('colAmount')}</th><th className="num">{t('refunded')}</th><th>{t('colStatus')}</th></tr></thead>
    <tbody>{[...list].reverse().map((p) => <tr key={p.id}><td>{dFmt(p.at)}</td><td><Link to={`/${p.kind === 'transport' ? 'delivery' : 'booking'}/${p.refId}`}>{p.refId}</Link></td>
      <td>{t(p.kind === 'transport' ? 'typeTransport' : 'typeRental')}</td><td className="num">{money(p.amount + (p.extra || 0))}</td><td className="num">{p.refunded ? money(p.refunded) : ''}</td><td><Chip p="ps" s={p.status} /></td></tr>)}</tbody></table></div>;
}

// Ordre d’affichage fixe (la base ne garde pas l’ordre des clés).
const DOC_ORDER = ['license', 'registration', 'nir', 'liability', 'cargo', 'tax', 'stripe'];

export function DocsTable({ u, own }) {
  const { t, dFmt, act, openModal } = useStore();
  const upload = async (e, k) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const d = await compress(f, 1400);
    if (d) act(async () => { const ref = await api.upload(d, { priv: true, docs: true }); await api.act('setDoc', { key: k, photo: ref }); }, t('docSent')).catch(() => {});
  };
  return <div className="tbl"><table><thead><tr><th>{t('colDoc')}</th><th>{t('colStatus')}</th><th>{t('colExp')}</th><th /></tr></thead>
    <tbody>{DOC_ORDER.filter((k) => (u.docs || {})[k]).map((k) => [k, u.docs[k]]).map(([k, v]) => <tr key={k}><td>{t('doc_' + k)}</td><td><span className={`st ${CLS[v[0]] || ''}`}>{t('dst_' + v[0])}</span></td><td>{v[1] ? dFmt(v[1]) : ''}</td>
      <td>{v[2] && <img className="zoom docthumb" src={fileUrl(v[2])} alt={t('doc_' + k)} onClick={() => openModal(<Zoom src={fileUrl(v[2])} />)} />}
        {own && k !== 'stripe' && !['na', 'approved'].includes(v[0]) && <> <label className="btn ghost sm docup">⬆ {t('uploadDoc')}<input className="vh" type="file" accept="image/*" onChange={(e) => upload(e, k)} /></label></>}</td></tr>)}</tbody></table></div>;
}

// Transporteur : versements Stripe (obligatoires) et vérification d’identité.
function DocsActions({ u }) {
  const { t, act } = useStore();
  const ok = u.docs && u.docs.stripe && u.docs.stripe[0] === 'approved';
  const connect = () => act(() => api.act('connectOnboard', { web: !native })).then((r) => {
    try { localStorage.setItem('charroi-back', '/dash/docs'); } catch (_) { /* ignoré */ }
    openExternal(r.url);
  }).catch(() => {});
  return <div className="panel" style={{ marginBottom: 14 }}>
    <h3>💳 {t('connectT')}</h3>
    {ok ? <p className="st ok">✓ {t('connectOk')}</p> : <><p className="small">{t('connectD')}</p><button className="btn sm" onClick={connect}>{t('connectBtn')}</button></>}
    <h3 style={{ marginTop: 16 }}>🛡️ {t('idvT')}</h3><IdvBlock ctx="docs" />
  </div>;
}

export default function Dashboard() {
  const { tab: tabParam } = useParams();
  const { S, me, t, tf, money, dFmt, lang } = useStore();
  const nav = useNavigate();
  if (me.role === 'admin') return <Navigate to="/admin" replace />;
  const go = (k) => nav(`/dash/${k}`);

  if (me.role === 'client') {
    const tab = tabParam || 'transport';
    const cs = S.cargos.filter((c) => c.clientId === me.id), ds = S.deliveries.filter((d) => d.clientId === me.id);
    const bs = S.bookings.filter((b) => b.clientId === me.id).slice().reverse();
    return <>
      <div className="head" style={{ marginBottom: 6 }}><h1 className="pt" style={{ margin: 0 }}>{t('dashT')}</h1><Link className="btn ghost sm" to="/history">🗂️ {t('navHistory')}</Link></div>
      <Tabs list={[['transport', 'tabTransport'], ['rental', 'tabRental'], ['payments', 'tabPayments']]} cur={tab} onPick={go} />
      {tab === 'transport' && <>
        <div className="head"><h2 style={{ margin: 0 }}>{t('myLoads')}</h2><Link className="btn amber sm" to="/publish">{t('c1a')}</Link></div>
        {cs.length ? cs.map((c) => <Link key={c.id} className="load" to={`/cargo/${c.id}`}><RouteLine a={c.from.city} b={c.to.city} />
          <div className="meta"><span>{c.id}</span><span>{dFmt(c.from.date)}</span><span>{tf('offersN', { n: S.offers.filter((o) => o.cargoId === c.id && o.status === 'PENDING').length })}</span></div>
          <div className="row"><span /><Chip p="cs" s={c.status} /></div></Link>) : <div className="empty">{t('emptyLoads')}</div>}
        <h2 style={{ marginTop: 24 }}>{t('myDeliveries')}</h2>
        {ds.length ? ds.slice().reverse().map((d) => <DelivRow key={d.id} d={d} />) : <div className="empty">{t('emptyDeliv')}</div>}
      </>}
      {tab === 'rental' && <>
        <div className="head"><h2 style={{ margin: 0 }}>{t('myBookings')}</h2><Link className="btn sm" to="/trailers">{t('c3a')}</Link></div>
        {bs.length ? bs.map((b) => <Link key={b.id} className="load" to={`/booking/${b.id}`}><b>{trName(S.trailers.find((x) => x.id === b.trailerId), lang)}</b>
          <div className="meta"><span>{b.id}</span><span>{dFmt(b.start)} → {dFmt(b.end)}</span></div><div className="row"><span className="price">{money(b.total)}</span><Chip p="bs" s={b.status} /></div></Link>)
          : <div className="empty">{t('emptyBookings')}</div>}
      </>}
      {tab === 'payments' && <PayTable list={S.payments.filter((p) => p.userId === me.id)} />}
    </>;
  }

  // Transporteur
  const tab = tabParam || 'deliveries';
  const ds = S.deliveries.filter((d) => d.carrierId === me.id).slice().reverse();
  const act = ds.filter((d) => !['COMPLETED', 'CANCELLED'].includes(d.status)), done = ds.filter((d) => ['COMPLETED', 'CANCELLED'].includes(d.status));
  const open = S.cargos.filter((c) => ['PUBLISHED', 'OFFERS_RECEIVED'].includes(c.status)).length;
  const ps = S.deliveries.filter((d) => d.carrierId === me.id).map((d) => [d, payOf(S, d.paymentId)]).filter(([, p]) => p);
  const rel = ps.filter(([, p]) => ['RELEASED', 'PARTIALLY_REFUNDED'].includes(p.status)).reduce((s, [, p]) => s + p.b.transfer, 0);
  const pend = ps.filter(([, p]) => p.status === 'CAPTURED').reduce((s, [, p]) => s + p.b.transfer, 0);
  const com = ps.filter(([, p]) => p.status !== 'REFUNDED').reduce((s, [, p]) => s + p.b.comm + p.b.commTps + p.b.commTvq, 0);
  return <>
    <div className="head" style={{ marginBottom: 6 }}><h1 className="pt" style={{ margin: 0 }}>{t('dashT')}</h1><Link className="btn ghost sm" to="/history">🗂️ {t('navHistory')}</Link></div>
    <Tabs list={[['deliveries', 'myDeliveries'], ['offers', 'myOffers'], ['revenue', 'revenue'], ['docs', 'documents']]} cur={tab} onPick={go} />
    {!me.verified && <div className="note">{t('notVerified')}</div>}
    {tab === 'deliveries' && <>
      <div className="head"><h2 style={{ margin: 0 }}>{t('inProgress')}</h2><Link className="btn sm" to="/loads">{t('availLoads')} ({open})</Link></div>
      {act.length ? act.map((d) => <DelivRow key={d.id} d={d} />) : <div className="empty">{t('emptyDeliv')}</div>}
      <h2 style={{ marginTop: 24 }}>{t('done')}</h2>
      {done.length ? done.map((d) => <DelivRow key={d.id} d={d} />) : <div className="empty">{t('emptyDeliv')}</div>}
    </>}
    {tab === 'offers' && (() => {
      const os = S.offers.filter((o) => o.carrierId === me.id).slice().reverse();
      return os.length ? os.map((o) => { const c = S.cargos.find((x) => x.id === o.cargoId); return c && <Link key={o.id} className="load" to={`/cargo/${c.id}`}><RouteLine a={c.from.city} b={c.to.city} />
        <div className="meta"><span>{c.id}</span><span>{dFmt(o.availDate)}</span></div><div className="row"><span className="price">{money(o.price)}</span><Chip p="os" s={o.status} /></div></Link>; })
        : <><div className="empty">{t('emptyOffers')}</div><div className="actions"><Link className="btn" to="/loads">{t('c2a')}</Link></div></>;
    })()}
    {tab === 'revenue' && <>
      <div className="panel statlist"><div><span>{t('revReleased')}</span><b>{money(rel)}</b></div><div><span>{t('revPending')}</span><b>{money(pend)}</b></div><div><span>{t('revComm')}</span><b>{money(com)}</b></div></div>
      <div className="tbl" style={{ marginTop: 14 }}><table><thead><tr><th>{t('colRef')}</th><th>{t('colRoute')}</th><th className="num">{t('payPrice')}</th><th className="num">{t('colComm')}</th><th className="num">{t('colNet')}</th><th>{t('colStatus')}</th></tr></thead>
        <tbody>{ps.map(([d, p]) => <tr key={d.id}><td><Link to={`/delivery/${d.id}`}>{d.id}</Link></td><td>{routeStr(cargoOf(S, d))}</td><td className="num">{money(p.b.price)}</td>
          <td className="num">{money(p.b.comm + p.b.commTps + p.b.commTvq)}</td><td className="num">{money(p.b.transfer)}</td><td><Chip p="ps" s={p.status} /></td></tr>)}</tbody></table></div>
    </>}
    {tab === 'docs' && <>
      <DocsActions u={me} />
      <DocsTable u={me} own />
      <div className="panel" style={{ marginTop: 14 }}><dl className="kv"><dt>{t('taxStatus')}</dt><dd>{me.taxReg ? t('taxReg') : t('taxSmall')}</dd></dl>
        <div className="actions"><Link className="btn ghost sm" to={`/carrier/${me.id}`}>{t('publicProfile')}</Link></div></div>
    </>}
  </>;
}
