// Réservation de remorque : inspections (admin), annulation (client), instructions, paiement.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { cancelRefund } from '@shared/pricing.js';
import { ageOn, toCents } from '../lib/util.js';
import { payOf, trName, inspResult } from '../lib/view.js';
import { Chip, SumRows, Thumbs, TrailerPic } from '../components/ui.jsx';
import { PhotoInput } from '../components/media.jsx';
import { ReviewBlock } from './Delivery.jsx';
import { Gate } from '../App.jsx';

export function InspModal({ b, k }) {
  const { t, act, closeModal } = useStore();
  const [f, setF] = useState({ state: 'good', comments: '', existing: '', tires: true, lights: true, brakes: true, hitch: true, newDmg: false, damageFee: '', lateFee: '0' });
  const [photos, setPhotos] = useState([]);
  const ch = (key) => (e) => setF({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => {
    if (k === 'before') {
      act(async () => {
        const ph = await api.uploadAll(photos, { priv: true });
        await api.act('inspBefore', { bookingId: b.id, x: { state: f.state, comments: f.comments, existing: f.existing, tires: f.tires, lights: f.lights, brakes: f.brakes, hitch: f.hitch, photos: ph } });
      }, t('rentStart')).then(closeModal, () => {});
    } else {
      act(async () => {
        const ph = await api.uploadAll(photos, { priv: true });
        return api.act('inspectionAfter', { bookingId: b.id, data: { state: f.state, comments: f.comments, newDmg: f.newDmg, damageFee: f.newDmg ? toCents(f.damageFee || 0) : 0, lateFee: toCents(f.lateFee || 0), photos: ph } });
      }, t('rentDone')).then(closeModal, () => {});
    }
  };
  return <>
    <h2>{k === 'before' ? t('inspBefore') : t('inspAfter')}</h2>
    {k === 'before' && ['tires', 'lights', 'brakes', 'hitch'].map((c) => <label key={c} className="chk"><input type="checkbox" checked={f[c]} onChange={ch(c)} />{t('i' + c[0].toUpperCase() + c.slice(1))}</label>)}
    <label htmlFor="ist">{t('iState')}</label><select id="ist" value={f.state} onChange={ch('state')}>{['good', 'fair', 'poor'].map((s) => <option key={s} value={s}>{t('cond_' + s)}</option>)}</select>
    {k === 'before' ? <><label htmlFor="iex">{t('iExisting')}</label><input id="iex" placeholder={t('iNone')} value={f.existing} onChange={ch('existing')} /></>
      : <>
        <label className="chk"><input type="checkbox" checked={f.newDmg} onChange={ch('newDmg')} />{t('iNewDmg')}</label>
        {f.newDmg && <><label htmlFor="idf">{t('iDamageFee')}</label><input id="idf" type="number" min="0" inputMode="decimal" value={f.damageFee} onChange={ch('damageFee')} /></>}
        <label htmlFor="ilf">{t('iLateFee')}</label><input id="ilf" type="number" min="0" inputMode="decimal" value={f.lateFee} onChange={ch('lateFee')} />
      </>}
    <label htmlFor="icm">{t('iComments')}</label><textarea id="icm" rows={2} value={f.comments} onChange={ch('comments')} />
    <label htmlFor="iph">{t('fPhotos')}</label><PhotoInput id="iph" list={photos} onChange={setPhotos} />
    <div className="actions"><button className="btn ghost" onClick={closeModal}>{t('cancel')}</button><button className="btn amber" onClick={save}>{t('iSave')}</button></div>
  </>;
}

export default function Booking() {
  const { id } = useParams();
  const { S, me, user, t, tf, money, dFmt, dtFmt, lang, act, openModal, toast } = useStore();
  const b = S.bookings.find((x) => x.id === id);
  if (!b) return me.role === 'guest' && !S.me ? <Gate kind="any" /> : <div className="empty">{t('notFound')}</div>;
  const tr = S.trailers.find((x) => x.id === b.trailerId), p = payOf(S, b.paymentId), cl = user(b.clientId);
  const isAd = me.role === 'admin', isCl = me.id === b.clientId;

  const cancel = () => {
    const est = cancelRefund(b, p.amount, p.refunded, S.settings);
    if (!window.confirm(tf('confirmCancelB', { a: money(est.refund) }))) return;
    act(() => api.act('cancelBooking', { bookingId: b.id })).then((r) => toast(tf('bookingCancelled', { a: money(r.refund) }))).catch(() => {});
  };
  let action = null;
  if (isAd && b.status === 'CONFIRMED') action = <button className="btn amber" onClick={() => openModal(<InspModal b={b} k="before" />)}>{t('inspBefore')}</button>;
  if (isAd && b.status === 'ACTIVE') action = <><button className="btn amber" onClick={() => openModal(<InspModal b={b} k="after" />)}>{t('inspAfter')}</button> <button className="btn ghost" onClick={() => act(() => api.act('sendReminder', { bookingId: b.id }), t('reminderSent')).catch(() => {})}>{t('sendReminder')}</button></>;
  if (isCl && b.status === 'CONFIRMED') action = <><button className="btn danger" onClick={cancel}>{t('cancelBooking')}</button><p className="small muted" style={{ margin: '8px 0 0' }}>{tf('cancelPolicy', { h: S.settings.freeCancelH })}</p></>;

  const insp = (k, title) => {
    const x = b.insp[k];
    if (!x) return null;
    return <div className="panel"><h3>{title}</h3>
      <p>{t('iState')} : <b>{t('cond_' + x.state)}</b>{k === 'before' && ` · ${['tires', 'lights', 'brakes', 'hitch'].filter((c) => x[c]).length}/4 ${t('iChecks').toLowerCase()}`}</p>
      {x.existing && <p>{t('iExisting')} : {x.existing}</p>}
      {x.newDmg && <p><b>{t('iNewDmg')}</b></p>}
      {x.comments && <p className="small">{x.comments}</p>}
      {k === 'after' && x.fees != null && <p className="note">{inspResult(x, t, tf, money)}</p>}
      <Thumbs list={x.photos} /><p className="small muted">{dtFmt(x.at)}</p>
    </div>;
  };

  return <>
    <div className="head"><div><p className="muted" style={{ margin: 0 }}>{b.id}</p><h1 className="pt" style={{ margin: 0 }}>{trName(tr, lang)}</h1></div><Chip p="bs" s={b.status} /></div>
    <div className="two"><div className="stack">
      {action && <div className="panel">{action}</div>}
      <div className="panel"><dl className="kv">
        <dt>{t('colClient')}</dt><dd>{cl.name}</dd>
        {b.renter && <><dt>{t('driver')}</dt><dd>{b.renter.name}</dd><dt>{t('renterDob')}</dt><dd>{dFmt(b.renter.dob)}<br /><span className="small muted">{tf('ageY', { n: ageOn(b.renter.dob, b.start) })}</span></dd>
          {b.renter.idv && b.renter.idv.status === 'verified' && <><dt>{t('idvBookT')}</dt><dd><span className="idvok">✓ {tf('idvDone', { d: dFmt(b.renter.idv.at) })}</span></dd></>}</>}
        <dt>{t('colDates')}</dt><dd>{dFmt(b.start)} → {dFmt(b.end)}<br />{tf('bDays', { n: b.days })}</dd>
        <dt>{t('specNo')}</dt><dd>{tr && tr.no}</dd>
      </dl>
        <div className="actions">{b.convId && <Link className="btn ghost sm" to={`/chat/${b.convId}`}>{t('openChat')}</Link>}<Link className="btn ghost sm" to={`/trailer/${b.trailerId}`}>{t('trailer')}</Link></div>
      </div>
      {cl.role === 'guest' && <div className="info"><b>✉️ {tf('guestConf', { e: (b.renter && b.renter.email) || cl.email || '' })}</b>{isCl && <p style={{ margin: '6px 0 0' }}>{t('guestKeep')} <Link to="/signup/client">{t('signup')}</Link></p>}</div>}
      {/* Adresse et heures : saisies par l’admin dans les Paramètres (rien d’inventé). */}
      <div className="panel"><h3>{t('instrT')}</h3><ul>
        {S.settings.rentalAddress && <li>{tf('instr1', { a: S.settings.rentalAddress })}</li>}
        {S.settings.rentalHours && <li>{tf('instr2', { h: S.settings.rentalHours })}</li>}
        {['instr3', 'instr4', 'instr5'].map((k) => <li key={k}>{t(k)}</li>)}
        {(S.settings.supportPhone || S.settings.supportEmail) && <li>{t('contactUs')} : {[S.settings.supportPhone, S.settings.supportEmail].filter(Boolean).join(' · ')}</li>}
      </ul></div>
      {insp('before', t('inspBefore'))}{insp('after', t('inspAfter'))}
      {b.status === 'COMPLETED' && isCl && <ReviewBlock kind="rental" refId={b.id} />}
    </div><div className="stack">
      {p && <div className="panel"><h3>{t('paymentStatus')} <Chip p="ps" s={p.status === 'PAID' && p.refunded ? 'PARTIALLY_REFUNDED' : p.status} /></h3>
        <SumRows rows={[[t('bRental'), money(b.price)], ['TPS', money(b.tps)], ['TVQ', money(b.tvq)], [b.depMode === 'auth' ? t('bDepositAuth') : t('bDepositCap'), money(b.deposit)], p.extra ? [`${t('iDamageFee')} / ${t('iLateFee')}`, money(p.extra)] : null, p.refunded ? [t('refunded'), '− ' + money(p.refunded), 'minus'] : null]} tot={[t('payTotal'), money(p.amount + (p.extra || 0) - p.refunded)]} />
      </div>}
      {tr && <div className="bigpic"><TrailerPic tr={tr} /></div>}
    </div></div>
  </>;
}
