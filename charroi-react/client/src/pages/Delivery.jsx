// Suivi d’une livraison : étapes, preuve de livraison, confirmation, litige, évaluations, paiement.
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { DFLOW } from '@shared/pricing.js';
import { toCents } from '../lib/util.js';
import { cargoOf, payOf, resText } from '../lib/view.js';
import { Chip, RouteLine, RouteMap, Stars, SumRows, Thumbs, Verified } from '../components/ui.jsx';
import { PhotoInput, SignaturePad } from '../components/media.jsx';
import { fileUrl } from '../lib/api.js';

function ProofModal({ d }) {
  const { t, tf, act, closeModal } = useStore();
  const [rec, setRec] = useState(''), [comment, setComment] = useState(''), [photos, setPhotos] = useState([]), [geo, setGeo] = useState(null);
  const [geoMsg, setGeoMsg] = useState(''), [err, setErr] = useState('');
  const sig = useRef(null);
  const addGeo = () => {
    try { navigator.geolocation.getCurrentPosition((p) => { setGeo(`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`); setGeoMsg(t('pLocAdded')); }, () => setGeoMsg(t('pLocFail')), { timeout: 8000 }); }
    catch (_) { setGeoMsg(t('pLocFail')); }
  };
  const submit = () => {
    if (!rec.trim()) return setErr(tf('errReq', { f: t('pRecipient') }));
    const s = sig.current.get();
    if (!s && !photos.length) return setErr(t('errSig'));
    act(async () => {
      const [ph, sg] = await api.uploadAll([photos[0] || null, s], { priv: true });
      await api.act('submitProof', { deliveryId: d.id, proof: { recipient: rec.trim(), comment: comment.trim(), photo: ph, sig: sg, geo } });
    }, t('deliveredMsg')).then(closeModal, () => {});
  };
  return <>
    <h2>{t('proofT')}</h2>
    <label htmlFor="pr1">{t('pRecipient')}</label><input id="pr1" autoComplete="off" value={rec} onChange={(e) => setRec(e.target.value)} />
    <label htmlFor="pr2">{t('pComment')}</label><textarea id="pr2" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
    <label htmlFor="pr3">{t('pPhoto')}</label><PhotoInput id="pr3" list={photos} onChange={setPhotos} max={1} capture />
    <label>{t('pSignature')}</label><SignaturePad sigRef={sig} />
    <div style={{ marginTop: 10 }}><button className="btn ghost sm" onClick={addGeo}>📍 {t('pLocation')}</button> <span className="small muted">{geoMsg}</span></div>
    {err && <div className="err" role="alert">{err}</div>}
    <div className="actions"><button className="btn ghost" onClick={closeModal}>{t('cancel')}</button><button className="btn amber" onClick={submit}>{t('pSubmit')}</button></div>
  </>;
}

function ProblemModal({ d }) {
  const { t, tf, act, closeModal } = useStore();
  const [reason, setReason] = useState('damaged'), [desc, setDesc] = useState(''), [photos, setPhotos] = useState([]), [err, setErr] = useState('');
  const send = () => {
    if (!desc.trim()) return setErr(tf('errReq', { f: t('dDesc') }));
    act(async () => {
      const ph = await api.uploadAll(photos, { priv: true });
      await api.act('openDispute', { deliveryId: d.id, reason, desc: desc.trim(), photos: ph });
    }, t('dSent')).then(closeModal, () => {});
  };
  return <>
    <h2>{t('dispT')}</h2>
    <label htmlFor="dp1">{t('dReason')}</label><select id="dp1" value={reason} onChange={(e) => setReason(e.target.value)}>
      {['damaged', 'missing', 'late', 'notdelivered', 'other'].map((r) => <option key={r} value={r}>{t('dr_' + r)}</option>)}</select>
    <label htmlFor="dp2">{t('dDesc')}</label><textarea id="dp2" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
    <label htmlFor="dp3">{t('fPhotos')}</label><PhotoInput id="dp3" list={photos} onChange={setPhotos} />
    {err && <div className="err" role="alert">{err}</div>}
    <div className="actions"><button className="btn ghost" onClick={closeModal}>{t('cancel')}</button><button className="btn danger" onClick={send}>{t('dSend')}</button></div>
  </>;
}

export function ResolveModal({ x }) {
  const { S, t, money, act, closeModal } = useStore();
  const d = S.deliveries.find((y) => y.id === x.deliveryId), p = payOf(S, d.paymentId);
  const [k, setK] = useState('release'), [amt, setAmt] = useState(''), [err, setErr] = useState('');
  const apply = () => {
    if (k === 'hold') return closeModal();
    let a = 0;
    if (k === 'partial') { a = toCents(amt); if (!(a > 0 && a < p.amount)) return setErr(t('errAmount')); }
    act(() => api.act('resolveDispute', { disputeId: x.id, kind: k, amount: a }), t('resDone')).then(closeModal, () => {});
  };
  return <>
    <h2>{t('resolve')} {x.id}</h2>
    <p><b>{t('dr_' + x.reason)}</b> : {x.desc}</p><Thumbs list={x.photos} />
    <p className="small muted">{t('paidTotal')} : {money(p.amount)}. {t('netCarrier')} : {money(p.b.transfer)}</p>
    <div className="stack">{['release', 'refund', 'partial', 'hold', 'info'].map((v) => (
      <label key={v} className="chk"><input type="radio" name="res" checked={k === v} onChange={() => setK(v)} />{t('res' + v[0].toUpperCase() + v.slice(1))}</label>))}</div>
    {k === 'partial' && <><label htmlFor="ra">{t('resAmount')}</label><input id="ra" type="number" min="0" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></>}
    {err && <div className="err" role="alert">{err}</div>}
    <div className="actions"><button className="btn ghost" onClick={closeModal}>{t('cancel')}</button><button className="btn amber" onClick={apply}>{t('resApply')}</button></div>
  </>;
}

export function ReviewBlock({ kind, refId }) {
  const { S, me, user, t, act } = useStore();
  const [star, setStar] = useState(0), [text, setText] = useState(''), [err, setErr] = useState('');
  const mine = S.reviews.find((r) => r.refId === refId && r.from === (S.me && S.me.id));
  const all = S.reviews.filter((r) => r.refId === refId);
  const send = () => {
    if (!star) return setErr(t('rPick'));
    act(() => api.act('sendReview', { kind, refId, stars: star, text: text.trim() }), t('rSent')).catch(() => {});
  };
  return <div className="panel"><h3>{t('reviewsT')}</h3>
    {all.map((r) => <p key={r.id}><Stars n={r.stars} /> <b>{user(r.from).name || r.fromName}</b><br />{r.text}</p>)}
    {mine ? <p className="small muted">{t('rDone')}</p> : me.role !== 'admin' && <>
      <h3 style={{ fontSize: '1.1rem' }}>{t('reviewT')}</h3>
      <div className="stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} aria-label={`${n}/5`} className={n <= star ? 'on' : ''} onClick={() => setStar(n)}>★</button>)}</div>
      <label htmlFor="rv">{t('rText')}</label><textarea id="rv" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="actions"><button className="btn" onClick={send}>{t('rSend')}</button></div>
    </>}
  </div>;
}

export default function Delivery() {
  const { id } = useParams();
  const { S, me, user, t, tf, money, dFmt, dtFmt, act, openModal, errMsg, toast } = useStore();
  const d = S.deliveries.find((x) => x.id === id);
  if (!d) return <div className="empty">{t('notFound')}</div>;
  const c = cargoOf(S, d), p = payOf(S, d.paymentId), cr = user(d.carrierId), cl = user(d.clientId);
  if (!c || !p) return <div className="empty">{t('notFound')}</div>;
  const b = p.b;
  const isCl = me.id === d.clientId, isCr = me.id === d.carrierId, isAd = me.role === 'admin';
  const disp = S.disputes.filter((x) => x.deliveryId === d.id), open = disp.find((x) => x.status === 'OPEN');
  const cur = DFLOW.indexOf(d.status === 'DISPUTED' ? 'DELIVERED' : d.status);
  const deadline = new Date(new Date((d.proof && d.proof.at) || Date.now()).getTime() + S.settings.autoConfirmH * 3600e3).toISOString();
  const advance = (s) => act(() => api.act('advanceDelivery', { deliveryId: d.id, status: s }), t('statusUpdated')).catch(() => {});
  const confirm = (adm) => act(() => api.act('confirmDelivery', { deliveryId: d.id, admin: !!adm }), t('confirmedMsg'))
    .then((r) => { if (r && !r.released && r.reason && r.reason !== 'DISPUTE_OPEN') toast(errMsg({ code: r.reason })); }).catch(() => {});

  let action = null;
  if (isCr && d.status === 'SCHEDULED') action = <button className="btn amber" onClick={() => advance('PICKED_UP')}>{t('actPickup')}</button>;
  if (isCr && d.status === 'PICKED_UP') action = <button className="btn amber" onClick={() => advance('IN_TRANSIT')}>{t('actTransit')}</button>;
  if (isCr && d.status === 'IN_TRANSIT') action = <button className="btn amber" onClick={() => openModal(<ProofModal d={d} />)}>{t('actDeliver')}</button>;
  if (isCr && d.status === 'DELIVERED') action = <p className="muted" style={{ margin: 0 }}>{tf('waitConfirm', { d: dtFmt(deadline) })}</p>;
  if (isCl && d.status === 'DELIVERED') action = <><p style={{ margin: '0 0 10px' }}>{tf('autoConfirm', { d: dtFmt(deadline) })}</p>
    <div className="actions" style={{ margin: 0 }}><button className="btn amber" onClick={() => confirm(false)}>{t('actConfirm')}</button><button className="btn danger" onClick={() => openModal(<ProblemModal d={d} />)}>{t('actProblem')}</button></div></>;
  if (isAd && d.status === 'DELIVERED') action = <button className="btn ghost" onClick={() => confirm(true)}>{t('simAuto')}</button>;
  if (isAd && d.status === 'CONFIRMED' && !open) action = <button className="btn amber" onClick={() => confirm(true)}>{t('retryPayout')}</button>;
  if (isAd && open) action = <button className="btn amber" onClick={() => openModal(<ResolveModal x={open} />)}>{t('resolve')}</button>;

  return <>
    <div className="head"><div><p className="muted" style={{ margin: 0 }}>{d.id}</p><RouteLine a={c.from.city} b={c.to.city} big /></div><Chip p="ds" s={d.status} /></div>
    {d.status !== 'CANCELLED' && <ol className="track">{DFLOW.map((s, i) => <li key={s} className={i < cur || (i === cur && s === 'COMPLETED') ? 'done' : i === cur ? 'cur' : ''}>{t('ds_' + s)}</li>)}</ol>}
    {open && <div className="note bad">{t('dispOpen')}</div>}
    <div className="two" style={{ marginTop: 16 }}><div className="stack">
      {action && <div className="panel">{action}</div>}
      <div className="panel"><dl className="kv">
        <dt>{t('client')}</dt><dd>{cl.name}{cl.company && <><br /><span className="small muted">{cl.company}</span></>}</dd>
        <dt>{t('carrier')}</dt><dd><Link to={`/carrier/${cr.id}`}>{cr.company}</Link><br /><Verified u={cr} /></dd>
        <dt>{t('pickup')}</dt><dd>{c.from.address}, {c.from.city}<br />{dFmt(d.pickupDate || c.from.date)}</dd>
        <dt>{t('dropoff')}</dt><dd>{c.to.address}, {c.to.city}</dd>
        <dt>{t('goods')}</dt><dd>{t('gt_' + c.goods.type)}, {c.goods.weight} kg</dd>
      </dl>
        <div className="actions"><Link className="btn ghost sm" to={`/chat/${d.convId}`}>{t('openChat')}</Link><Link className="btn ghost sm" to={`/cargo/${c.id}`}>{c.id}</Link></div>
      </div>
      {d.proof && <div className="panel"><h3>{t('proofT')}</h3>
        <dl className="kv"><dt>{t('pRecipient')}</dt><dd>{d.proof.recipient}</dd><dt>{t('fDate')}</dt><dd>{dtFmt(d.proof.at)}</dd>{d.proof.geo && <><dt>{t('pLocShown')}</dt><dd>{d.proof.geo}</dd></>}</dl>
        {d.proof.comment && <p style={{ marginTop: 8 }}>{d.proof.comment}</p>}
        <div className="thumbs">{d.proof.photo && <img src={fileUrl(d.proof.photo)} alt="" />}{d.proof.sig && <img src={fileUrl(d.proof.sig)} alt={t('pSignature')} style={{ width: 180, objectFit: 'contain', background: '#fff' }} />}</div>
      </div>}
      {disp.map((x) => <div key={x.id} className="panel"><h3>{t('dispT')} <Chip p="ds" s="DISPUTED" /></h3>
        <p><b>{t('dr_' + x.reason)}</b> : {x.desc}</p><Thumbs list={x.photos} />
        {x.status === 'RESOLVED' && <p className="note">{tf('dispResolved', { r: resText(x.resolution, t, money) })}</p>}
        {x.info && <p className="small muted">{t('dispInfo')}</p>}</div>)}
      {d.status === 'COMPLETED' && (isCl || isCr) && <ReviewBlock kind="delivery" refId={d.id} />}
    </div><div className="stack">
      <div className="panel"><h3>{t('paymentStatus')} <Chip p="ps" s={p.status} /></h3>
        {isCl ? <><SumRows rows={[[t('payPrice'), money(b.price)], b.cTps ? [t('payCarrierTax'), money(b.cTps + b.cTvq)] : null, b.fee ? [t('payServiceFee'), money(b.fee + b.feeTax)] : null, p.refunded ? [t('refunded'), '− ' + money(p.refunded), 'minus'] : null]} tot={[t('paidTotal'), money(b.total - p.refunded)]} />
          <p className="small muted" style={{ marginTop: 10 }}>{t('payNote')}</p></>
          : isCr ? <SumRows rows={[[t('payPrice'), money(b.price)], b.cTps ? [t('payCarrierTax'), money(b.cTps + b.cTvq)] : null, [tf('commission', { r: b.rate }), '− ' + money(b.comm), 'minus'], [t('commTax'), '− ' + money(b.commTps + b.commTvq), 'minus']]} tot={[t('netCarrier'), money(Math.max(0, b.transfer))]} />
            : <SumRows rows={[[t('paidTotal'), money(b.total)], [tf('commission', { r: b.rate }), money(b.comm)], [t('commTax'), money(b.commTps + b.commTvq)], [t('netCarrier'), money(b.transfer)], [t('stripeFee'), '− ' + money(b.stripe), 'minus'], [t('payoutFee'), '− ' + money(b.payout), 'minus'], p.refunded ? [t('refunded'), money(p.refunded)] : null]} tot={[t('margin'), money(p.status === 'REFUNDED' ? -b.stripe : b.margin)]} />}
      </div>
      <RouteMap a={c.from.city} b={c.to.city} />
    </div></div>
  </>;
}
