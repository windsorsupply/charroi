// Administration : vue d’ensemble, transporteurs, clients, cargaisons, livraisons, transactions,
// litiges, remorques, réservations, paramètres.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { REGIONS } from '@shared/geo.js';
import { routeStr, trailerStatus } from '../lib/util.js';
import { cargoOf, resText, trName } from '../lib/view.js';
import { Avatar, Chip, Tabs, Thumbs } from '../components/ui.jsx';
import { DocsTable } from './Dashboard.jsx';
import { ResolveModal } from './Delivery.jsx';
import { InspModal } from './Booking.jsx';
import { TrailerModal } from './Trailers.jsx';

const VOLK = { '1-5': 'vol_1_5', '6-10': 'vol_6_10', '10+': 'vol_10p' };

function CarrierFile({ c }) {
  const { t, money } = useStore();
  const kv = (k, v) => (v ? <><dt>{t(k)}</dt><dd>{v}</dd></> : null);
  return <>
    <div className="who" style={{ marginBottom: 10 }}><Avatar u={c} size={56} /><div><b>{c.name}</b><br /><span className="small muted">{c.email || ''} · {c.phone || ''}</span></div></div>
    {c.idv && c.idv.status === 'verified' && <p style={{ margin: '0 0 8px' }}><span className="idvok">✓ {t('idvT')}</span> <span className="small muted">{c.idv.id}</span></p>}
    <dl className="kv">
      {kv('suNeq', c.neq)}{kv('suBizAddr', [c.address, c.city, c.postal].filter(Boolean).join(', '))}{c.regions && c.regions.length > 0 && kv('suRegions', c.regions.map((r) => REGIONS[r]).join(', '))}
      {c.veh && kv('vehicle', `${t('vh_' + c.vehicle)} · ${[c.veh.make, c.veh.model, c.veh.year].filter(Boolean).join(' ')}`)}{c.veh && kv('suPlate', c.veh.plate)}
      {c.licClass && kv('suLicClass', t('lic' + c.licClass))}{kv('suNir', c.nir)}{c.ins && kv('suInsurer', `${c.ins.insurer} · ${c.ins.policy}`)}{c.ins && kv('suCargoAmt', money(c.ins.cargoAmt))}
      {kv('suTps', c.tps)}{kv('suTvq', c.tvq)}
    </dl>
  </>;
}

function DocsModal({ c }) {
  const { t, act, closeModal } = useStore();
  const verify = (ok) => act(() => api.act('verifyCarrier', { userId: c.id, ok }), ok ? t('approved') : t('rejectedMsg')).then(closeModal, () => {});
  return <>
    <h2>{c.company}</h2><CarrierFile c={c} />
    <h3 style={{ marginTop: 14 }}>{t('documents')}</h3><DocsTable u={c} />
    <p className="small muted" style={{ marginTop: 10 }}>{t('taxStatus')} : {c.taxReg ? t('taxReg') : t('taxSmall')}</p>
    <div className="actions">{!c.verified && <button className="btn" onClick={() => verify(true)}>{t('approve')}</button>}<button className="btn ghost" onClick={closeModal}>{t('close')}</button></div>
  </>;
}

const TEXT_KEYS = ['rentalAddress', 'rentalHours', 'supportEmail', 'supportPhone', 'privacyOfficer', 'termsFr', 'termsEn', 'privacyFr', 'privacyEn'];

function Settings() {
  const { S, t, act } = useStore();
  const [f, setF] = useState({ ...Object.fromEntries(TEXT_KEYS.map((k) => [k, ''])), ...S.settings });
  const ch = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const field = (k, lab, step) => <div><label htmlFor={`st-${k}`}>{lab}</label><input id={`st-${k}`} type="number" step={step || 0.1} min="0" inputMode="decimal" value={f[k]} onChange={ch(k)} /></div>;
  const text = (k, lab, type) => <div><label htmlFor={`st-${k}`}>{lab}</label><input id={`st-${k}`} type={type || 'text'} value={f[k]} onChange={ch(k)} /></div>;
  const area = (k, lab) => <><label htmlFor={`st-${k}`}>{lab}</label><textarea id={`st-${k}`} rows={6} value={f[k]} onChange={ch(k)} /></>;
  const save = () => act(() => api.act('saveSettings', { p: {
    ...Object.fromEntries(['commission', 'serviceFee', 'autoConfirmH', 'tps', 'tvq'].map((k) => [k, Number(f[k])])),
    ...Object.fromEntries(TEXT_KEYS.map((k) => [k, String(f[k] || '')])),
  } }), t('setSaved')).catch(() => {});
  return <div style={{ maxWidth: 760 }}>
    <div className="panel">
      <div className="grid2">{field('commission', t('setCommission'))}{field('serviceFee', t('setFee'))}{field('autoConfirmH', t('setAuto'), 1)}{field('tps', t('setTps'), 0.001)}{field('tvq', t('setTvq'), 0.001)}</div>
      <p className="note">{t('setNote')}</p>
    </div>
    <div className="panel"><h3>{t('setCompanyT')}</h3>
      {text('rentalAddress', t('setRentalAddress'))}{text('rentalHours', t('setRentalHours'))}
      <div className="grid2">{text('supportEmail', t('setSupportEmail'), 'email')}{text('supportPhone', t('setSupportPhone'), 'tel')}</div>
    </div>
    <div className="panel"><h3>{t('setLegalT')}</h3><p className="small muted">{t('setLegalH')}</p>
      {text('privacyOfficer', t('setPrivacyOfficer'))}
      {area('termsFr', t('setTermsFr'))}{area('termsEn', t('setTermsEn'))}{area('privacyFr', t('setPrivacyFr'))}{area('privacyEn', t('setPrivacyEn'))}
    </div>
    <div className="actions"><button className="btn" onClick={save}>{t('save')}</button></div>
  </div>;
}

export default function Admin() {
  const { tab: tp } = useParams();
  const tab = tp || 'overview';
  const { S, user, t, tf, money, dFmt, lang, act, openModal } = useStore();
  const nav = useNavigate();
  const T = [['overview', 'aOverview'], ['carriers', 'aCarriers'], ['clients', 'aClients'], ['loads', 'aLoads'], ['deliveries', 'aDeliveries'], ['tx', 'aTx'], ['disputes', 'aDisputes'], ['trailers', 'aTrailers'], ['bookings', 'aBookings'], ['settings', 'aSettings']];
  const tp2 = S.payments.filter((p) => p.kind === 'transport'), rp = S.payments.filter((p) => p.kind === 'rental');
  const st = S.settings;
  const stripeFee = (p) => (p.b.stripe != null ? p.b.stripe : Math.round((p.amount * st.stripePct) / 100) + st.stripeFixed);
  const users = Object.values(S.users).filter((u) => !u.stub && u.id !== 'admin');
  const table = (head, rows) => <div className="tbl"><table><thead><tr>{head.map(([l, num], i) => <th key={i} className={num ? 'num' : ''}>{l}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>;
  let body = null;

  if (tab === 'overview') {
    const gmv = tp2.reduce((s, p) => s + p.amount - p.refunded, 0);
    const comm = tp2.filter((p) => p.status !== 'REFUNDED').reduce((s, p) => s + p.b.comm + p.b.fee, 0);
    const stripe = S.payments.reduce((s, p) => s + stripeFee(p), 0);
    const margin = tp2.reduce((s, p) => s + (p.status === 'REFUNDED' ? -p.b.stripe : p.b.comm + p.b.fee - p.b.stripe - (['RELEASED', 'PARTIALLY_REFUNDED'].includes(p.status) ? p.b.payout : 0)), 0);
    const live = S.bookings.filter((b) => b.status !== 'CANCELLED');
    const tax = tp2.filter((p) => p.status !== 'REFUNDED').reduce((s, p) => s + p.b.commTps + p.b.commTvq + p.b.feeTax, 0) + live.reduce((s, b) => s + b.tps + b.tvq, 0);
    const rent = live.reduce((s, b) => s + b.price, 0) + rp.reduce((s, p) => s + (p.extra || 0), 0);
    const held = tp2.filter((p) => p.status === 'CAPTURED').reduce((s, p) => s + p.b.transfer, 0);
    body = <div className="panel statlist">{[[t('kGmv'), money(gmv)], [tf('commission', { r: st.commission }), money(comm)], [t('kStripe'), money(stripe)], [t('kMargin'), money(margin)], [t('kTax'), money(tax)], [t('kRental'), money(rent)], [t('kHeld'), money(held)],
      [t('kDisputes'), S.disputes.filter((d) => d.status === 'OPEN').length], [t('kPendingC'), users.filter((u) => u.role === 'carrier' && !u.verified && !u.rejected).length], [t('kActiveR'), S.bookings.filter((b) => b.status === 'ACTIVE').length]]
      .map(([a, b]) => <div key={a}><span>{a}</span><b>{b}</b></div>)}</div>;
  }
  if (tab === 'carriers') {
    const verify = (id, ok) => act(() => api.act('verifyCarrier', { userId: id, ok }), ok ? t('approved') : t('rejectedMsg')).catch(() => {});
    body = table([[t('colCompany')], [t('colName')], [t('colRegion')], [t('verifStatus')], [t('taxStatus')], [t('colActions')]],
      users.filter((u) => u.role === 'carrier' && !u.deleted).map((c) => <tr key={c.id}><td><Link to={`/carrier/${c.id}`}>{c.company}</Link></td><td>{c.name}</td><td>{REGIONS[c.region] || ''}</td>
        <td>{c.verified ? <span className="st ok">{t('dst_approved')}</span> : c.rejected ? <span className="st bad">{t('dst_rejected')}</span> : <span className="st warn">{t('dst_pending')}</span>}</td>
        <td>{c.taxReg ? 'TPS/TVQ' : t('taxSmall').split(' (')[0]}</td>
        <td><button className="btn ghost sm" onClick={() => openModal(<DocsModal c={c} />)}>{t('viewDocs')}</button> {!c.verified && <><button className="btn sm" onClick={() => verify(c.id, true)}>{t('approve')}</button> <button className="btn danger sm" onClick={() => verify(c.id, false)}>{t('reject')}</button></>}</td></tr>));
  }
  if (tab === 'clients') body = table([[t('colName')], [t('colCompany')], [t('colCity')], [t('colPhone')], [t('colVolume')], [t('myLoads'), 1], [t('myBookings'), 1]],
    users.filter((u) => u.role === 'client' && !u.deleted).map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.company}</td><td>{c.city}</td><td>{c.phone}</td><td>{c.shipVolume ? t(VOLK[c.shipVolume]) : ''}</td>
      <td className="num">{S.cargos.filter((x) => x.clientId === c.id).length}</td><td className="num">{S.bookings.filter((x) => x.clientId === c.id).length}</td></tr>));
  if (tab === 'loads') body = table([[t('colRef')], [t('colRoute')], [t('colDate')], [t('colClient')], [t('colOffers'), 1], [t('colStatus')]],
    S.cargos.map((c) => <tr key={c.id}><td><Link to={`/cargo/${c.id}`}>{c.id}</Link></td><td>{routeStr(c)}</td><td>{dFmt(c.from.date)}</td><td>{user(c.clientId).name}</td>
      <td className="num">{S.offers.filter((o) => o.cargoId === c.id && o.status !== 'WITHDRAWN').length}</td><td><Chip p="cs" s={c.status} /></td></tr>));
  if (tab === 'deliveries') body = table([[t('colRef')], [t('colRoute')], [t('colClient')], [t('colCarrier')], [t('payPrice'), 1], [t('colStatus')]],
    S.deliveries.slice().reverse().map((d) => <tr key={d.id}><td><Link to={`/delivery/${d.id}`}>{d.id}</Link></td><td>{routeStr(cargoOf(S, d))}</td><td>{user(d.clientId).name}</td><td>{user(d.carrierId).company}</td>
      <td className="num">{money(d.price)}</td><td><Chip p="ds" s={d.status} /></td></tr>));
  if (tab === 'tx') body = table([[t('colDate')], [t('colRef')], [t('colType')], [t('colTotal'), 1], [t('colComm'), 1], [t('colTaxes'), 1], [t('stripeFee'), 1], [t('colNet'), 1], [t('refunded'), 1], [t('colStatus')]],
    S.payments.slice().reverse().map((p) => { const tr = p.kind === 'transport'; return <tr key={p.id}><td>{dFmt(p.at)}</td><td><Link to={`/${tr ? 'delivery' : 'booking'}/${p.refId}`}>{p.refId}</Link></td><td>{t(tr ? 'typeTransport' : 'typeRental')}</td>
      <td className="num">{money(p.amount + (p.extra || 0))}</td><td className="num">{tr ? money(p.b.comm) : ''}</td><td className="num">{money(tr ? p.b.commTps + p.b.commTvq : p.b.tps + p.b.tvq)}</td>
      <td className="num">{money(stripeFee(p))}</td><td className="num">{tr ? money(p.b.transfer) : ''}</td><td className="num">{p.refunded ? money(p.refunded) : ''}</td><td><Chip p="ps" s={p.status} /></td></tr>; }));
  if (tab === 'disputes') body = S.disputes.length ? S.disputes.slice().reverse().map((x) => {
    const d = S.deliveries.find((y) => y.id === x.deliveryId);
    return <div key={x.id} className="panel"><div className="head" style={{ margin: '0 0 6px' }}><h3 style={{ margin: 0 }}>{x.id} · <Link to={`/delivery/${d.id}`}>{d.id}</Link></h3>
      <span className={`st ${x.status === 'OPEN' ? 'bad' : 'ok'}`}>{x.status === 'OPEN' ? t('ds_DISPUTED') : t('ds_COMPLETED')}</span></div>
      <p><b>{t('dr_' + x.reason)}</b> : {x.desc}</p><Thumbs list={x.photos} />{x.resolution && <p className="note">{resText(x.resolution, t, money)}</p>}
      {x.status === 'OPEN' && <div className="actions"><button className="btn amber sm" onClick={() => openModal(<ResolveModal x={x} />)}>{t('resolve')}</button><Link className="btn ghost sm" to={`/chat/${d.convId}`}>{t('openChat')}</Link></div>}
    </div>;
  }) : <div className="empty">{t('noDisputes')}</div>;
  if (tab === 'trailers') body = <>
    <div className="actions" style={{ margin: '0 0 12px' }}><button className="btn" onClick={() => openModal(<TrailerModal />)}>{t('addTrailer')}</button></div>
    {table([[t('specNo')], [t('colTrailer')], [t('specType')], [t('perDay').replace('/ ', ''), 1], [t('deposit'), 1], [t('colStatus')]],
      S.trailers.map((tr) => <tr key={tr.id}><td>{tr.no}</td><td><Link to={`/trailer/${tr.id}`}>{trName(tr, lang)}</Link></td><td>{t('tt_' + tr.type)}</td><td className="num">{money(tr.day)}</td><td className="num">{money(tr.deposit)}</td><td><Chip p="ts" s={trailerStatus(S, tr)} /></td></tr>))}
  </>;
  if (tab === 'bookings') body = table([[t('colRef')], [t('colTrailer')], [t('colClient')], [t('colDates')], [t('colTotal'), 1], [t('colStatus')], [t('colActions')]],
    S.bookings.slice().reverse().map((b) => { const tr = S.trailers.find((x) => x.id === b.trailerId); return <tr key={b.id}><td><Link to={`/booking/${b.id}`}>{b.id}</Link></td><td>{tr && tr.no}</td><td>{user(b.clientId).name || (b.renter && b.renter.name)}</td>
      <td>{dFmt(b.start)} → {dFmt(b.end)}</td><td className="num">{money(b.total)}</td><td><Chip p="bs" s={b.status} /></td>
      <td>{b.status === 'CONFIRMED' ? <button className="btn sm" onClick={() => openModal(<InspModal b={b} k="before" />)}>{t('inspBefore')}</button> : b.status === 'ACTIVE' ? <button className="btn sm" onClick={() => openModal(<InspModal b={b} k="after" />)}>{t('inspAfter')}</button> : null}</td></tr>; }));
  if (tab === 'settings') body = <Settings />;

  return <><h1 className="pt">{t('adminT')}</h1><Tabs list={T} cur={tab} onPick={(k) => nav(`/admin/${k}`)} />{body}</>;
}
