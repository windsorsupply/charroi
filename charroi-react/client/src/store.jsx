// État global de l’app : données du serveur, langue, messages, fenêtres, brouillons.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { makeT, L } from '@shared/i18n.js';
import { DEFAULT_SETTINGS } from '@shared/pricing.js';
import { api, onChanged, setToken } from './lib/api.js';
import { fmt } from './lib/util.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const EMPTY = { settings: DEFAULT_SETTINGS, users: {}, cargos: [], offers: [], deliveries: [], payments: [], disputes: [], reviews: [], trailers: [], bookings: [], busy: [], convs: [], notifs: [], me: null };
const GUEST = { id: 'guest', role: 'guest', name: '', docs: {}, ratingN: 0, ratingSum: 0 };
const UIKEY = 'charroi-ui-v2';

// Codes d’erreur du serveur → textes affichés.
const ERR = { NOT_VERIFIED: 'notVerified', LOAD_CLOSED: 'loadClosed', DATES_TAKEN: 'bTaken', TRAILER_UNAVAILABLE: 'bMaint', IDV_REQUIRED: 'idvBookErr', FULL_NAME: 'errFullName', BAD_EMAIL: 'errEmail', ACTIVE_DELIVERIES: 'delActive', ACTIVE_BOOKINGS: 'delActive', CARRIER_NO_STRIPE: 'payoutNoStripe', STRIPE_NOT_READY: 'stripeNotReady', OFFER_UNAVAILABLE: 'offerGone', ALREADY_ASSIGNED: 'offerGone', BAD_DATES: 'bDateErr', ADMIN_CANNOT_BOOK: 'bRoleErr', BAD_GOODS: 'fixBefore', RECIPIENT_REQUIRED: 'errReq', AUTH_REQUIRED: 'gateAny' };

function loadUi() { try { return JSON.parse(localStorage.getItem(UIKEY)) || {}; } catch (_) { return {}; } }

export function StoreProvider({ children }) {
  const saved = useRef(loadUi());
  const [raw, setRaw] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState(saved.current.lang || ((navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr'));
  const [draft, setDraft] = useState(saved.current.draft || null);
  const [filters, setFilters] = useState(saved.current.f || {});
  const [next, setNext] = useState(saved.current.next || null);
  const [toastMsg, setToastMsg] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const toastT = useRef(null);
  // Thème : 'auto' (suit l’appareil), 'light' ou 'dark'. Gardé sur l’appareil.
  const [theme, setThemeState] = useState(() => { try { return localStorage.getItem('charroi-theme') || 'auto'; } catch (_) { return 'auto'; } });
  const mq = useMemo(() => (window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null), []);
  const [sysDark, setSysDark] = useState(() => !!(mq && mq.matches));
  useEffect(() => {
    if (!mq) return undefined;
    const f = (e) => setSysDark(e.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [mq]);
  const dark = theme === 'dark' || (theme === 'auto' && sysDark);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#171C19' : '#159A59');
    try { localStorage.setItem('charroi-theme', theme); } catch (_) { /* stockage indisponible */ }
  }, [theme, dark]);
  const { t, tf } = useMemo(() => makeT(lang), [lang]);
  const F = useMemo(() => fmt(lang), [lang]);

  useEffect(() => {
    try { localStorage.setItem(UIKEY, JSON.stringify({ lang, draft, f: filters, next })); } catch (_) { /* stockage plein */ }
  }, [lang, draft, filters, next]);
  useEffect(() => { document.documentElement.lang = lang; document.title = t('pageTitle'); }, [lang, t]);

  const refresh = useCallback(async () => {
    const d = await api.state();
    setRaw(d);
    return d;
  }, []);

  useEffect(() => {
    let first = true;
    refresh().then((d) => {
      // Langue du profil au premier chargement, si l’appareil n’en a pas déjà une.
      if (first && d.me && d.me.lang && !saved.current.lang) setLangState(d.me.lang);
      first = false;
    }).catch(() => {}).finally(() => setReady(true));
    let tm = null;
    return onChanged(() => { clearTimeout(tm); tm = setTimeout(() => refresh().catch(() => {}), 300); });
  }, [refresh]);

  // Noms traduits (équipe Charroi, comptes supprimés) et profils inconnus.
  const S = useMemo(() => {
    const users = { ...raw.users, admin: { id: 'admin', role: 'admin', name: t('adminTeam'), company: t('company'), docs: {}, ratingN: 0, ratingSum: 0 } };
    Object.values(users).forEach((u) => { if (u.deleted) users[u.id] = { ...u, name: t('deletedUser'), company: '' }; });
    return { ...raw, users };
  }, [raw, t]);

  const user = useCallback((id) => S.users[id] || { id, role: '', name: '—', company: '—', docs: {}, ratingN: 0, ratingSum: 0, stub: true }, [S]);

  // Utilisateur courant. Les admins partagent l’identité « admin » (messages, notifications).
  const me = useMemo(() => {
    if (!S.me) return GUEST;
    return S.me.role === 'admin' ? { ...S.me, id: 'admin', uid: S.me.id } : S.me;
  }, [S.me]);

  const toast = useCallback((m) => {
    setToastMsg(m);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastMsg(''), 2800);
  }, []);

  const errMsg = useCallback((e) => {
    const c = (e && (e.code || e.message)) || '';
    if (c === 'TOO_YOUNG') return tf('errAge', { a: S.settings.minAge || 21 });
    if (ERR[c]) return t(ERR[c]);
    if (L[c]) return t(c);
    console.warn(e);
    return t('errGeneric') + (c && c.length < 80 ? ` (${c})` : '');
  }, [t, tf, S.settings.minAge]);

  // Appel au serveur : indicateur d’activité, rechargement des données, message clair.
  const act = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      await refresh();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast(errMsg(e));
      throw e;
    } finally { setBusy(false); }
  }, [refresh, toast, errMsg]);

  const signIn = useCallback(async (token) => { setToken(token); return refresh(); }, [refresh]);
  const signOut = useCallback(async () => { setToken(null); setNext(null); return refresh(); }, [refresh]);

  const setLang = useCallback((l) => {
    setLangState(l);
    if (raw.me && raw.me.role !== 'guest') api.act('updateProfile', { lang: l }).catch(() => {});
  }, [raw.me]);

  const value = {
    S, ready, me, role: me.role, user, lang, setLang, t, tf, ...F, theme, setTheme: setThemeState, dark,
    refresh, act, toast, errMsg, busy, setBusy,
    modal, openModal: setModal, closeModal: () => setModal(null),
    draft, setDraft, filters, setFilters, next, setNext, signIn, signOut, toastMsg,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
