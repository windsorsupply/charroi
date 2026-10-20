// Structure de l’app : barre du haut, navigation du bas, pages, fenêtres, messages.
import { useEffect } from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { LANGS, makeT } from '@shared/i18n.js';
import { useStore } from './store.jsx';
import { Avatar, Icon } from './components/ui.jsx';
import { notifVars, myConvs } from './lib/view.js';
import { api } from './lib/api.js';
import { useNative } from './native.js';
import Home from './pages/Home.jsx';
import Publish from './pages/Publish.jsx';
import Loads from './pages/Loads.jsx';
import Cargo from './pages/Cargo.jsx';
import Delivery from './pages/Delivery.jsx';
import { Trailers, Trailer } from './pages/Trailers.jsx';
import Booking from './pages/Booking.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import { Messages, Chat } from './pages/Messages.jsx';
import { Profile, CarrierProfile } from './pages/Profile.jsx';
import { Login, SignupChoice, Signup, Reset } from './pages/Auth.jsx';
import { Help, Terms, Privacy } from './pages/Info.jsx';
import StripeReturn from './pages/StripeReturn.jsx';
import History from './pages/History.jsx';

function Notifs() {
  const st = useStore();
  const { S, me, t, tf, dtFmt, closeModal, refresh } = st;
  const nav = useNavigate();
  const list = S.notifs.filter((n) => n.to === me.id || n.to === (S.me && S.me.id)).slice(0, 40);
  const read = (id) => api.act('readNotifs', { id }).then(refresh).catch(() => {});
  return <>
    <div className="head" style={{ marginBottom: 6 }}><h2 style={{ margin: 0 }}>{t('notifs')}</h2>
      {list.some((n) => !n.read) && <button className="btn ghost sm" onClick={() => { read(null); closeModal(); }}>{t('markRead')}</button>}</div>
    {list.length ? list.map((n) => (
      <a key={n.id} className={`notif ${n.read ? '' : 'unread'}`} href={n.link || '#/home'} onClick={(e) => { e.preventDefault(); read(n.id); closeModal(); nav((n.link || '#/home').slice(1)); }}>
        {tf(n.key, notifVars(n.vars, st))}<small>{dtFmt(n.at)}</small>
      </a>)) : <p className="muted">{t('noNotifs')}</p>}
    <div className="actions"><button className="btn ghost" onClick={closeModal}>{t('close')}</button></div>
  </>;
}

function Chrome() {
  const st = useStore();
  const { S, me, role, t, lang, setLang, openModal, toast, dark, setTheme } = st;
  const loc = useLocation();
  const route = loc.pathname.split('/')[1] || 'home';
  const unread = S.notifs.filter((n) => (n.to === me.id || n.to === (S.me && S.me.id)) && !n.read).length;
  const unreadMsgs = myConvs(S, me).filter((c) => c.msgs.length && c.msgs[c.msgs.length - 1].from !== me.id && !(c.seen || {})[me.id]).length;
  const links = role === 'guest' ? [['/home', 'navHome'], ['/trailers', 'navTrailers'], ['/loads', 'navLoads'], ['/help', 'footerHelp']]
    : role === 'admin' ? [['/home', 'navHome'], ['/admin', 'navAdmin'], ['/trailers', 'navTrailers'], ['/messages', 'navMessages'], ['/history', 'navHistory']]
      : role === 'carrier' ? [['/home', 'navHome'], ['/loads', 'navLoads'], ['/trailers', 'navTrailers'], ['/dash', 'navDash'], ['/messages', 'navMessages'], ['/history', 'navHistory']]
        : [['/home', 'navHome'], ['/publish', 'navPublish'], ['/trailers', 'navTrailers'], ['/dash', 'navDash'], ['/messages', 'navMessages'], ['/history', 'navHistory']];
  const on = (k) => (route === k ? 'on' : '');
  return <>
    <header className="top"><div className="in">
      <Link className="logo" to="/home" aria-label="Charroi"><i /><b>Charroi</b></Link>
      <nav className="dnav">{links.map(([h, k]) => <Link key={h} to={h} className={on(h.slice(1))}>{t(k)}</Link>)}</nav>
      <div className="tools">
        <button className="themebtn" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={t('themeToggle')} title={t('themeToggle')}>{dark ? '☀️' : '🌙'}</button>
        <div className="lang" role="group" aria-label={t('language')}>{LANGS.map((l) => <button key={l} className={l === lang ? 'on' : ''} onClick={() => { setLang(l); toast(makeT(l).t('langSaved')); }}>{l.toUpperCase()}</button>)}</div>
        {role === 'guest' ? <><Link className="btn ghost sm hide-xs" to="/login">{t('login')}</Link><Link className="btn sm" to="/signup">{t('signup')}</Link></>
          : <><button className="bell" onClick={() => openModal(<Notifs />)} aria-label={t('notifs')}>🔔{unread > 0 && <span>{unread}</span>}</button>
            <Link to="/profile" className="me-chip" aria-label={t('navProfile')}><Avatar u={me} size={32} /></Link></>}
      </div>
    </div></header>
    {S.devSim && <div className="devbar">{t('devSim')}</div>}
    <main id="view"><Pages /></main>
    <footer className="foot"><span>© {new Date().getFullYear()} Charroi</span><Link to="/help">{t('footerHelp')}</Link><Link to="/terms">{t('footerTerms')}</Link><Link to="/privacy">{t('footerPrivacy')}</Link><span>{t('brandSub')}</span></footer>
    <nav className="bottom" aria-label="Navigation">
      <Link to="/home" className={on('home')}>{Icon.home}{t('navHome')}</Link>
      <Link to="/search" className={['search', 'loads', 'trailers', 'admin'].includes(route) ? 'on' : ''}>{Icon.search}{t('navSearch')}</Link>
      <Link to="/publish" className="pub"><span className="dot">{Icon.plus}</span><em>{t('navPublish')}</em></Link>
      <Link to="/messages" className={route === 'messages' || route === 'chat' ? 'on' : ''}>{Icon.msg}{t('navMessages')}{unreadMsgs > 0 && <span className="badge">{unreadMsgs}</span>}</Link>
      {role === 'guest' ? <Link to="/login" className={['login', 'signup'].includes(route) ? 'on' : ''}>{Icon.user}{t('login')}</Link>
        : <Link to="/profile" className={['profile', 'dash'].includes(route) ? 'on' : ''}>{Icon.user}{t('navProfile')}</Link>}
    </nav>
  </>;
}

// Écran « connexion requise » ; retient la page demandée pour y revenir après connexion.
export function Gate({ kind }) {
  const { t, setNext } = useStore();
  const loc = useLocation();
  useEffect(() => { setNext(loc.pathname); }, [loc.pathname]);
  const msg = { client: 'gateClient', carrier: 'gateCarrier', admin: 'gateAdmin' }[kind] || 'gateAny';
  const su = kind === 'carrier' ? '/signup/carrier' : kind === 'client' ? '/signup/client' : '/signup';
  return <div className="gate panel"><div className="gicon" aria-hidden="true">🔒</div><h1 className="pt">{t('gateT')}</h1><p className="muted">{t(msg)}</p>
    <div className="actions" style={{ justifyContent: 'center' }}><Link className="btn" to="/login">{t('login')}</Link>{kind !== 'admin' && <Link className="btn ghost" to={su}>{t('signup')}</Link>}</div>
    {kind !== 'admin' && kind !== 'carrier' && <p className="small" style={{ marginTop: 18 }}>🛻 {t('gateRent')} <Link to="/trailers">{t('c3a')}</Link></p>}
  </div>;
}

function Wrong({ need }) {
  const { t, tf, role, signOut } = useStore();
  return <div className="gate panel"><div className="gicon" aria-hidden="true">👤</div><h1 className="pt">{t('wrongT')}</h1>
    <p className="muted">{tf('wrongD', { r: t('role_' + role), n: t('role_' + need) })}</p>
    <div className="actions" style={{ justifyContent: 'center' }}><button className="btn" onClick={signOut}>{t('logout')}</button></div></div>;
}

function NeedRole({ roles, kind, children }) {
  const { role } = useStore();
  if (roles.includes(role)) return children;
  if (role === 'guest') return <Gate kind={kind} />;
  if (kind === 'admin') return <Gate kind="admin" />;
  return <Wrong need={kind} />;
}

function AlreadyIn({ children }) {
  const { role, me, t, tf, signOut } = useStore();
  if (role === 'guest') return children;
  return <div className="gate panel"><p>{tf('alreadyIn', { n: me.name })}</p>
    <div className="actions" style={{ justifyContent: 'center' }}><Link className="btn" to="/home">{t('goHome')}</Link><button className="btn ghost" onClick={signOut}>{t('logout')}</button></div></div>;
}

function Search() {
  const { role } = useStore();
  return <Navigate to={role === 'carrier' ? '/loads' : role === 'admin' ? '/admin' : '/trailers'} replace />;
}

function NotFound() {
  const { t } = useStore();
  return <div className="empty"><p>{t('notFound')}</p><Link className="btn" to="/home">{t('goHome')}</Link></div>;
}

function ScrollTop() {
  const loc = useLocation();
  const { closeModal } = useStore();
  useEffect(() => { window.scrollTo(0, 0); closeModal(); }, [loc.pathname]);
  return null;
}

function SignupRoute() {
  const { type } = useParams();
  return <AlreadyIn>{type ? <Signup type={type === 'carrier' ? 'carrier' : 'client'} /> : <SignupChoice />}</AlreadyIn>;
}

const ANY = ['client', 'carrier', 'admin'];
function Pages() {
  return <Routes>
    <Route path="/home" element={<Home />} />
    <Route path="/search" element={<Search />} />
    <Route path="/publish" element={<NeedRole roles={['client']} kind="client"><Publish /></NeedRole>} />
    <Route path="/loads" element={<Loads />} />
    <Route path="/cargo/:id" element={<Cargo />} />
    <Route path="/delivery/:id" element={<NeedRole roles={ANY} kind="any"><Delivery /></NeedRole>} />
    <Route path="/trailers" element={<Trailers />} />
    <Route path="/trailer/:id" element={<Trailer />} />
    <Route path="/booking/:id" element={<Booking />} />
    <Route path="/dash/:tab?" element={<NeedRole roles={ANY} kind="any"><Dashboard /></NeedRole>} />
    <Route path="/admin/:tab?" element={<NeedRole roles={['admin']} kind="admin"><Admin /></NeedRole>} />
    <Route path="/messages" element={<NeedRole roles={ANY} kind="any"><Messages /></NeedRole>} />
    <Route path="/chat/:id" element={<Chat />} />
    <Route path="/history/:year?" element={<NeedRole roles={ANY} kind="any"><History /></NeedRole>} />
    <Route path="/profile" element={<NeedRole roles={ANY} kind="any"><Profile /></NeedRole>} />
    <Route path="/carrier/:id" element={<CarrierProfile />} />
    <Route path="/login" element={<AlreadyIn><Login /></AlreadyIn>} />
    <Route path="/signup/:type?" element={<SignupRoute />} />
    <Route path="/reset" element={<Reset />} />
    <Route path="/help" element={<Help />} />
    <Route path="/terms" element={<Terms />} />
    <Route path="/privacy" element={<Privacy />} />
    <Route path="/stripe-return/:r?" element={<StripeReturn />} />
    <Route path="/" element={<Navigate to="/home" replace />} />
    <Route path="*" element={<NotFound />} />
  </Routes>;
}

function Shell() {
  const { ready, modal, closeModal, toastMsg, busy } = useStore();
  useNative();
  useEffect(() => { document.body.classList.toggle('busy', busy); }, [busy]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  if (!ready) return <div className="bootscreen"><i /><b>Charroi</b></div>;
  return <>
    <ScrollTop />
    <Chrome />
    {modal && <div id="modal"><div className="back" onClick={(e) => e.target === e.currentTarget && closeModal()}><div className="sheet" role="dialog" aria-modal="true">{modal}</div></div></div>}
    <div id="toast" className={toastMsg ? 'show' : ''} role="status" aria-live="polite">{toastMsg}</div>
  </>;
}

export default function App() {
  return <HashRouter><Shell /></HashRouter>;
}
