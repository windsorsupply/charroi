// Communication avec le serveur Node : jeton de connexion, requêtes, fichiers, temps réel.
import { io } from 'socket.io-client';

// App web servie par le serveur : adresse relative. App mobile : adresse complète du serveur.
export const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const KEY = 'charroi-token';

let token = null;
try { token = localStorage.getItem(KEY); } catch (_) { /* stockage indisponible */ }
export const getToken = () => token;
export function setToken(t) {
  token = t || null;
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (_) { /* ignoré */ }
  reconnect();
}

export class ApiError extends Error { constructor(code) { super(code); this.code = code; } }

async function request(method, url, body) {
  let r;
  try {
    r = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (_) { throw new ApiError('errOffline'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || `HTTP_${r.status}`);
  return j;
}

export const api = {
  state: () => request('GET', '/api/state'),
  act: (name, body) => request('POST', `/api/a/${name}`, body || {}),
  auth: (what, body) => request('POST', `/api/auth/${what}`, body || {}),
  pushToken: (body) => request('POST', '/api/push-token', body),
  health: () => request('GET', '/api/health'),
  // Envoie une image (data URL déjà compressée). Retourne la référence à enregistrer.
  async upload(dataUrl, opts = {}) {
    if (!dataUrl || !String(dataUrl).startsWith('data:')) return dataUrl || null;
    return (await request('POST', '/api/upload', { data: dataUrl, priv: !!opts.priv, docs: !!opts.docs })).ref;
  },
  uploadAll: (arr, opts) => Promise.all((arr || []).map((d) => api.upload(d, opts))),
};

// Adresse affichable d’un fichier envoyé (« /files/… » vient du serveur).
export const fileUrl = (ref) => (ref && String(ref).startsWith('/files/') ? BASE + ref : ref || '');

// ---------- Temps réel : le serveur signale « changed », l’app recharge ses données ----------
let socket = null;
const listeners = new Set();
export function onChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function reconnect() {
  if (socket) socket.disconnect();
  socket = io(BASE || undefined, { auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('changed', () => listeners.forEach((f) => f()));
  socket.on('connect', () => listeners.forEach((f) => f()));
}
reconnect();
