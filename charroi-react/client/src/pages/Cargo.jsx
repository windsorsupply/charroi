// Détail d’une cargaison : informations, photos, offres reçues (client), formulaire d’offre (transporteur).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { calcTransport, VEH, SPECIAL } from '@shared/pricing.js';
import { hoursFor } from '@shared/geo.js';
import { today, toCents, num, mask, pkgCount, cuft } from '../lib/util.js';
import { dims, dimsList } from '../lib/view.js';
import { Avatar, Chip, Opts, Rating, RouteLine, RouteMap, Thumbs, Verified } from '../components/ui.jsx';
import { PhotoBox } from '../components/media.jsx';
import PayModal from '../components/PayModal.jsx';

function OfferForm({ c }) {
  const { me, t, tf, money, S, act } = useStore();
  const [f, setF] = useState({ price: c.budget ? c.budget / 100 : '', avail: c.from.date, hours: hoursFor(c.km), vehicle: VEH.includes(me.vehicle) ? me.vehicle : 'standard', comment: '' });
  const [err, setErr] = useState('');
  const p = toCents(f.price);
  const send = () => {
    if (!(p > 0)) return setErr(tf('errNum', { f: t('oPrice') }));
    if (!f.avail) return setErr(tf('errReq', { f: t('oAvail') }));
    setErr('');
    act(() => api.act('submitOffer', { cargoId: c.id, price: p, avail: f.avail, hours: num(f.hours) || hoursFor(c.km), comment: f.comment.trim(), vehicle: f.vehicle }), t('offerSent')).catch(() => {});
  };
  const ch = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return <>
    <h2>{t('makeOffer')}</h2>
    <div className="grid2">
      <div><label htmlFor="o1">{t('oPrice')}</label><input id="o1" type="number" min="1" inputMode="decimal" value={f.price} onChange={ch('price')} /></div>
      <div><label htmlFor="o2">{t('oAvail')}</label><input id="o2" type="date" min={today()} value={f.avail} onChange={ch('avail')} /></div>
    </div>
    <div className="grid2">
      <div><label htmlFor="o3">{t('oHours')}</label><input id="o3" type="number" min="0.5" step="0.5" inputMode="decimal" value={f.hours} onChange={ch('hours')} /></div>
      <div><label htmlFor="o5">{t('fVehicle')}</label><select id="o5" value={f.vehicle} onChange={ch('vehicle')}><Opts arr={VEH} pre="vh_" /></select></div>
    </div>
    <p className="small muted" style={{ margin: '6px 0 0' }}>{tf('carrierVehNote', { v: t('vh_' + c.transport.vehicle) })}</p>
    <label htmlFor="o4">{t('oComment')}</label><textarea id="o4" rows={2} value={f.comment} onChange={ch('comment')} />
    {p > 0 && <p className="small muted" style={{ marginTop: 10 }}>{tf('youReceive', { n: money(calcTransport(p, me.taxReg, S.settings).transfer), r: S.settings.commission })}</p>}
    {err && <div className="err" role="alert">{err}</div>}
    <div className="actions"><button className="btn amber" onClick={send}>{t('oSend')}</button></div>
  </>;
}

export default function Cargo() {
  const { id } = useParams();
  const st = useStore();
  const { S, me, user, t, tf, money, dFmt, fmtN, act, openModal } = st;
  const nav = useNavigate();
  const c = S.cargos.find((x) => x.id === id);
  if (!c) return <div className="empty">{t('notFound')}</div>;
  const owner = me.id === c.clientId;
  const dl = S.deliveries.find((d) => d.cargoId === c.id && d.status !== 'CANCELLED');
  const showAddr = c.hasAddr;
  const offers = S.offers.filter((o) => o.cargoId === c.id);
  const g = c.goods;
  const special = SPECIAL.includes(c.transport.vehicle);
  const left = Math.round((new Date(c.to.date + 'T12:00') - new Date(today() + 'T12:00')) / 864e5);
  const open = ['PUBLISHED', 'OFFERS_RECEIVED'].includes(c.status);
  const preChat = (crId) => act(() => api.act('preChat', { cargoId: c.id, carrierId: crId })).then((cv) => nav(`/chat/${cv}`)).catch(() => {});

  const accept = (o) => {
    const cr = user(o.carrierId), b = calcTransport(o.price, cr.taxReg, S.settings);
    openModal(<PayModal kind="delivery" amount={b.total} intent={() => api.act('transportIntent', { offerId: o.id })} summary={<>
      <RouteLine a={c.from.city} b={c.to.city} /><p className="muted">{cr.company}, {dFmt(o.availDate)}</p>
      <table className="sum"><tbody>
        <tr><td>{t('payPrice')}</td><td>{money(b.price)}</td></tr>
        {b.cTps > 0 && <tr><td>{t('payCarrierTax')}</td><td>{money(b.cTps + b.cTvq)}</td></tr>}
        {b.fee > 0 && <tr><td>{t('payServiceFee')}</td><td>{money(b.fee + b.feeTax)}</td></tr>}
        <tr className="tot"><td>{t('payTotal')}</td><td>{money(b.total)}</td></tr>
      </tbody></table>
      <div className="note">{t('payNote')}</div>
    </>} />);
  };

  let offersPanel = null;
  if (owner || me.role === 'admin') {
    const list = offers.filter((o) => o.status !== 'WITHDRAWN').sort((a, b) => a.price - b.price);
    const low = list.filter((o) => o.status === 'PENDING')[0];
    offersPanel = <div className="panel" style={{ marginTop: 16 }}><h2>{t('offersT')} ({list.length})</h2>
      {list.length ? list.map((o) => {
        const cr = user(o.carrierId), b = calcTransport(o.price, cr.taxReg, S.settings);
        return <div key={o.id} className={`offer ${o === low ? 'best' : ''}`}>
          <div>
            <div className="who"><Avatar u={cr} size={44} /><div><Link to={`/carrier/${cr.id}`}><b>{cr.company}</b></Link> <Verified u={cr} /></div></div><br />
            <Rating u={cr} />
            <p className="small" style={{ margin: '6px 0 0' }}>{tf('availFrom', { d: dFmt(o.availDate) })}, {tf('hoursEst', { h: o.hours })}. {t('vh_' + o.vehicle)}</p>
            {o.vehicle !== c.transport.vehicle && <p className="small" style={{ margin: '4px 0 0' }}><span className="st warn">{t('otherVeh')}</span> {tf('otherVehD', { a: t('vh_' + c.transport.vehicle), b: t('vh_' + o.vehicle) })}</p>}
            {o.comment && <p className="small muted" style={{ margin: '4px 0 0' }}>« {dl ? o.comment : mask(o.comment, t('masked'))} »</p>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="price">{money(o.price)}</div>
            {b.cTps > 0 && <div className="small muted">+ TPS/TVQ = {money(b.total)}</div>}
            {o === low && <div className="small muted">{t('lowest')}</div>}
            {o.status === 'PENDING' && owner && !dl ? <button className="btn amber sm" style={{ marginTop: 8 }} onClick={() => accept(o)}>{t('accept')}</button> : <Chip p="os" s={o.status} />}
            {special && owner && !dl && o.status === 'PENDING' && <><br /><button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => preChat(o.carrierId)}>💬 {t('contactCarrier')}</button></>}
          </div>
        </div>;
      }) : <p className="muted">{t('noOffers')}</p>}
    </div>;
  } else if (me.role === 'carrier') {
    const mine = offers.find((o) => o.carrierId === me.id && o.status !== 'WITHDRAWN');
    offersPanel = <div className="panel" style={{ marginTop: 16 }}>
      {mine ? <>
        <h2>{t('yourOffer')}</h2>
        <div className="head" style={{ margin: 0 }}><span className="price">{money(mine.price)}</span><Chip p="os" s={mine.status} /></div>
        <p className="small muted">{tf('availFrom', { d: dFmt(mine.availDate) })}, {tf('hoursEst', { h: mine.hours })}</p>
        {mine.status === 'PENDING' && <button className="btn ghost sm" onClick={() => act(() => api.act('withdrawOffer', { offerId: mine.id }), t('offerWithdrawn')).catch(() => {})}>{t('withdraw')}</button>}
      </> : !open ? <p className="muted">{t('loadClosed')}</p> : !me.verified ? <div className="note">{t('notVerified')}</div> : <OfferForm c={c} />}
      {special && me.verified && open && <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => preChat(me.id)}>💬 {t('contactClient')}</button>}
    </div>;
  } else if (open) {
    offersPanel = <div className="panel" style={{ marginTop: 16 }}><h2>{t('makeOffer')}</h2><p className="muted">{t(me.role === 'guest' ? 'offerGateG' : 'offerGateC')}</p>
      {me.role === 'guest' && <div className="actions"><Link className="btn amber" to="/signup/carrier">{t('suCarrierA')}</Link><Link className="btn ghost" to="/login" onClick={() => st.setNext(`/cargo/${c.id}`)}>{t('login')}</Link></div>}</div>;
  }

  const editable = owner && ['PUBLISHED', 'OFFERS_RECEIVED', 'TRANSPORTER_SELECTED'].includes(c.status);
  const setPhotos = async (list) => {
    await act(async () => { const refs = await api.uploadAll(list); await api.act('setCargoPhotos', { cargoId: c.id, photos: refs }); }, t('photosAdded')).catch(() => {});
  };

  return <>
    <div className="head"><div><p className="muted" style={{ margin: 0 }}>{c.id}</p><RouteLine a={c.from.city} b={c.to.city} big /></div><Chip p="cs" s={c.status} /></div>
    {special && <div className="special" style={{ marginBottom: 14 }}><b>⚠️ {t('special')}</b><p style={{ margin: '4px 0 0' }}>{t('specialNote')}</p></div>}
    <div className="two"><div className="stack">
      <div className="panel"><dl className="kv">
        <dt>{t('pickup')}</dt><dd>{showAddr && c.from.address + ', '}{c.from.city} {showAddr && c.from.postal}<br />{dFmt(c.from.date)} {c.from.time}</dd>
        <dt>{t('dropoff')}</dt><dd>{showAddr && c.to.address + ', '}{c.to.city} {showAddr && c.to.postal}<br />{dFmt(c.to.date)} {c.to.time}</dd>
        <dt>{t('postedLbl')}</dt><dd>{dFmt(c.createdAt)}</dd>
        <dt>{t('deadlineLbl')}</dt><dd className={left <= 1 ? 'urgtxt' : ''}>{dFmt(c.to.date)}{c.to.time ? ' ' + c.to.time : ''}</dd>
        <dt>{t('distance')}</dt><dd>{tf('kmUnit', { n: c.km })}, {tf('hUnit', { n: hoursFor(c.km) })}</dd>
        <dt>{t('budget')}</dt><dd>{c.budget ? money(c.budget) : t('quoteWanted')}</dd>
      </dl>
        {!showAddr && <p className="small muted" style={{ margin: '10px 0 0' }}>{t('addrHidden')}</p>}
        {showAddr && (c.from.notes || c.to.notes) && <p className="small" style={{ margin: '10px 0 0' }}>{c.from.notes} {c.to.notes}</p>}
      </div>
      <div className="panel"><h3>{t('goods')}</h3><p>{g.desc}</p>
        <dl className="kv">
          <dt>{t('fType')}</dt><dd>{t('gt_' + g.type)}</dd><dt>{t('fWeight')}</dt><dd>{g.weight} kg</dd><dt>{t('fCount')}</dt><dd>{pkgCount(g)}</dd>
          {dims(g, t, fmtN) && <><dt>{t('specDims')}</dt><dd>{dimsList(g, t, tf, fmtN).map((l, i) => <div key={i}>{l}</div>)}</dd><dt>{t('volume')}</dt><dd>≈ {cuft(g, fmtN)} {t('unitVol')}</dd></>}
          {g.value > 0 && <><dt>{t('value')}</dt><dd>{money(g.value)}</dd></>}
        </dl>
        <p style={{ marginTop: 10 }}>{g.fragile && <span className="st warn">{t('fragile')}</span>} {c.transport.loading && <span className="st">{t('loadingY')}</span>} {c.transport.unloading && <span className="st">{t('unloadingY')}</span>}</p>
        <p className="small muted">{t('vehicle')} : {t('vh_' + c.transport.vehicle)}. {t('capacity')} : {c.transport.capacity} kg</p>
        {g.notes && <p className="small">{g.notes}</p>}
        {editable ? <PhotoBox list={g.photos || []} onChange={setPhotos} /> : <Thumbs list={g.photos} />}
      </div>
    </div><div className="stack">
      <RouteMap a={c.from.city} b={c.to.city} />
      {dl && (owner || me.role === 'admin' || dl.carrierId === me.id) && <Link className="btn full" to={`/delivery/${dl.id}`}>{t('seeDelivery')} {dl.id}</Link>}
      {owner && !dl && open && <button className="btn danger full" onClick={() => window.confirm(t('confirmCancel')) && act(() => api.act('cancelCargo', { cargoId: c.id }), t('loadCancelled')).catch(() => {})}>{t('cancelLoad')}</button>}
    </div></div>
    {offersPanel}
  </>;
}
