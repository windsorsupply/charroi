// Messagerie : liste des conversations et fil de discussion (mis à jour en direct).
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store.jsx';
import { api } from '../lib/api.js';
import { mask } from '../lib/util.js';
import { convOther, convTitle, myConvs } from '../lib/view.js';
import { L } from '@shared/i18n.js';
import { Gate } from '../App.jsx';

export function Messages() {
  const { S, me, user, t, lang } = useStore();
  const last = (c) => (c.msgs.at(-1) || {}).at || '';
  const list = myConvs(S, me).sort((a, b) => last(b).localeCompare(last(a)));
  return <><h1 className="pt">{t('msgsT')}</h1>
    {list.length ? <div className="panel" style={{ padding: 0 }}>{list.map((c) => {
      const l = c.msgs.at(-1), unread = l && l.from !== me.id && !(c.seen || {})[me.id];
      const txt = l ? (l.sys && L[l.text] ? t(l.text) : l.text) : '';
      return <Link key={c.id} className="conv" to={`/chat/${c.id}`}><b>{convOther(S, c, me, user, t)}</b> {unread && <span className="st warn">●</span>}<br />
        <span className="small muted">{convTitle(S, c, t, lang)}</span>{l && <><br /><span className="small">{txt.slice(0, 90)}</span></>}</Link>;
    })}</div> : <div className="empty">{t('noConvs')}</div>}
  </>;
}

export function Chat() {
  const { id } = useParams();
  const { S, me, user, t, lang, dtFmt, refresh, toast, errMsg } = useStore();
  const [txt, setTxt] = useState('');
  const box = useRef(null), inp = useRef(null);
  const c = S.convs.find((x) => x.id === id);
  const n = c ? c.msgs.length : 0;
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [n]);
  useEffect(() => {
    if (c && c.msgs.length && !(c.seen || {})[me.id]) api.act('markSeen', { convId: id }).catch(() => {});
  }, [id, n]);
  if (!c) return me.role === 'guest' && !S.me ? <Gate kind="any" /> : <div className="empty">{t('notFound')}</div>;

  const name = (m) => (m === 'admin' ? (c.kind === 'rental' ? t('company') : t('adminName')) : user(m).name);
  const link = c.kind === 'transport' ? `/delivery/${c.refId}` : c.kind === 'pre' ? `/cargo/${c.refId}` : `/booking/${c.refId}`;
  const pre = c.kind === 'pre' && !S.deliveries.some((d) => d.cargoId === c.refId && d.carrierId === c.members[1] && d.status !== 'CANCELLED');
  const show = (m) => (m.sys && L[m.text] ? t(m.text) : pre ? mask(m.text, t('masked')) : m.text);
  const send = async () => {
    const v = txt.trim();
    if (!v) return;
    setTxt('');
    try { await api.act('sendMessage', { convId: id, text: v }); await refresh(); } catch (e) { setTxt(v); toast(errMsg(e)); }
    inp.current && inp.current.focus();
  };
  return <>
    <div className="head"><div><h1 className="pt" style={{ margin: 0 }}>{convOther(S, c, me, user, t)}</h1><Link className="small" to={link}>{convTitle(S, c, t, lang)}</Link></div></div>
    {pre && <p className="small muted">🔒 {t('preConvNote')}</p>}
    <div className="chat" ref={box}>{c.msgs.length ? c.msgs.map((m, i) => (
      <div key={i} className={`bub ${m.sys ? 'sys' : m.from === me.id ? 'me' : ''}`}>{show(m)}<small>{m.from === me.id ? '' : name(m.from) + ' · '}{dtFmt(m.at)}</small></div>
    )) : <p className="muted" style={{ margin: 'auto' }}>{t('noMsgs')}</p>}</div>
    <div className="composer"><input ref={inp} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={t('msgPh')} onKeyDown={(e) => e.key === 'Enter' && send()} aria-label={t('msgPh')} />
      <button className="btn" onClick={send}>{t('send')}</button></div>
  </>;
}
