// Historique : transports et locations terminés ou annulés, gardés année par année,
// avec totaux et export CSV (pour vos dossiers et votre comptabilité).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { loc2 } from '../lib/util.js';
import { Chip, RouteLine } from '../components/ui.jsx';

export default function History() {
  const { year: yParam } = useParams();
  const { me, t, tf, money, dFmt, lang, errMsg, S } = useStore();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState('all');

  // Recharge quand l’année change, ou quand une activité se termine (données en direct).
  const doneCount = S.deliveries.filter((d) => ['COMPLETED', 'CANCELLED'].includes(d.status)).length + S.bookings.filter((b) => ['COMPLETED', 'CANCELLED'].includes(b.status)).length;
  useEffect(() => {
    let live = true;
    api.act('history', { year: yParam ? Number(yParam) : undefined })
      .then((r) => live && (setData(r), setErr(''))).catch((e) => live && setErr(errMsg(e)));
    return () => { live = false; };
  }, [yParam, doneCount]);

  if (err) return <div className="empty">{err}</div>;
  if (!data) return <div className="empty"><span className="spin" style={{ width: 22, height: 22, borderWidth: 3, display: 'inline-block' }} /></div>;

  const items = data.items.filter((i) => kind === 'all' || i.kind === kind);
  const nT = data.items.filter((i) => i.kind === 'transport').length, nR = data.items.filter((i) => i.kind === 'rental').length;
  const total = items.filter((i) => i.status !== 'CANCELLED' || i.amount > 0).reduce((s, i) => s + (i.amount || 0), 0);
  const totalLabel = me.role === 'carrier' ? t('histEarned') : me.role === 'admin' ? t('histVolume') : t('histSpent');
  const label = (i) => (i.kind === 'transport' ? `${i.from} → ${i.to}` : `${loc2(i.trailer, lang)} (${i.trailerNo})`);

  const csv = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [[t('colDate'), t('colRef'), t('colType'), `${t('colRoute')} / ${t('colTrailer')}`, t('histWith'), t('colAmount'), t('colStatus')]];
    items.forEach((i) => rows.push([String(i.date).slice(0, 10), i.id, t(i.kind === 'transport' ? 'typeTransport' : 'typeRental'), label(i), i.with === null ? t('deletedUser') : i.with ?? t('company'),
      lang === 'fr' ? (i.amount / 100).toFixed(2).replace('.', ',') : (i.amount / 100).toFixed(2), t((i.kind === 'transport' ? 'ds_' : 'bs_') + i.status)]));
    const blob = new Blob(['\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `charroi-${t('navHistory').toLowerCase()}-${data.year}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return <>
    <h1 className="pt">{t('historyT')}</h1>
    <p className="muted" style={{ marginTop: -4 }}>{t(me.role === 'admin' ? 'historySubAdmin' : 'historySub')} {t('histKept')}</p>
    {!data.years.length ? <div className="empty">{t('histNone')}</div> : <>
      <div className="tabs" role="tablist">{data.years.map((y) => <button key={y} role="tab" className={y === data.year ? 'on' : ''} onClick={() => nav(`/history/${y}`)}>{y}</button>)}</div>
      <div className="radrow" style={{ marginTop: 0, marginBottom: 12 }}>
        {[['all', 'histAll'], ['transport', 'histTransport'], ['rental', 'histRental']].map(([k, l]) => <button key={k} type="button" className={`chipbtn ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{t(l)}</button>)}
      </div>
      <div className="panel statlist">
        <div><span>{t('histYear')}</span><b>{data.year}</b></div>
        <div><span>{tf('histCount', { n: nT, m: nR })}</span><b>{nT + nR}</b></div>
        <div><span>{totalLabel}</span><b>{money(total)}</b></div>
      </div>
      <div className="actions" style={{ margin: '12px 0' }}><button className="btn ghost sm" onClick={csv} disabled={!items.length}>⬇ {t('histCsv')}</button></div>
      {items.length ? items.map((i) => (
        <Link key={i.kind + i.id} className="load" to={i.kind === 'transport' ? `/delivery/${i.id}` : `/booking/${i.id}`}>
          {i.kind === 'transport' ? <RouteLine a={i.from} b={i.to} /> : <b>🛻 {label(i)}</b>}
          <div className="meta">
            <span>{dFmt(String(i.date).slice(0, 10))}</span><span>{i.id}</span>
            {i.kind === 'rental' && <span>{dFmt(i.start)} → {dFmt(i.end)}</span>}
            {i.kind === 'transport' && i.goodsType && <span>{t('gt_' + i.goodsType)}</span>}
            {i.with !== undefined && i.with !== null && i.with !== '' && <span>{t('histWith')}{lang === 'fr' ? ' : ' : ': '}{i.with}</span>}
            {i.with === null && <span>{t('histWith')}{lang === 'fr' ? ' : ' : ': '}{t('deletedUser')}</span>}
          </div>
          <div className="row"><span className="price">{money(i.amount)}</span><Chip p={i.kind === 'transport' ? 'ds' : 'bs'} s={i.status} /></div>
        </Link>
      )) : <div className="empty">{t('histEmpty')}</div>}
    </>}
  </>;
}
