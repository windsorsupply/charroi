// Notifications push (Firebase Cloud Messaging, iOS + Android), dans la langue de chaque personne.
// Requiert FCM_SERVICE_ACCOUNT (JSON du compte de service Firebase) ; sinon, rien n’est envoyé.
import { importPKCS8, SignJWT } from 'jose';
import { config } from './config.js';
import { many, one, query } from './db.js';
import { makeT } from '../../shared/i18n.js';

const money = (c, lang) => new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD' }).format(c / 100);
const date = (s, lang) => new Date(s.length === 10 ? s + 'T12:00' : s).toLocaleDateString(lang === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short' });

export function notifText(key, vars, lang) {
  const v = { ...(vars || {}) };
  if (typeof v.p === 'number') v.p = money(v.p, lang);
  if (typeof v.d === 'string' && /^\d{4}-\d\d-\d\d/.test(v.d)) v.d = date(v.d.slice(0, 10), lang);
  return makeT(lang).tf(key, v);
}

let cached = null;
async function accessToken(sa) {
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const key = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(sa.client_email).setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await r.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

export async function sendPush(notifId) {
  const sa = config.fcmServiceAccount;
  if (!sa) return;
  const n = await one('select * from notifications where id = $1', [notifId]);
  if (!n) return;
  const users = n.to_id === 'admin'
    ? await many("select id, lang from users where role = 'admin' and not deleted")
    : await many('select id, lang from users where id::text = $1', [n.to_id]);
  if (!users.length) return;
  const tokens = await many('select token, user_id from push_tokens where user_id = any($1::uuid[])', [users.map((u) => u.id)]);
  if (!tokens.length) return;
  const unread = (await one('select count(*)::int n from notifications where to_id = $1 and not read', [n.to_id])).n;
  const at = await accessToken(sa);
  for (const t of tokens) {
    const lang = users.find((u) => u.id === t.user_id)?.lang || 'fr';
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        token: t.token,
        notification: { title: 'Charroi', body: notifText(n.key, n.vars, lang) },
        data: { link: n.link || '#/home' },
        android: { priority: 'high', notification: { channel_id: 'charroi', color: '#159A59' } },
        apns: { payload: { aps: { sound: 'default', badge: unread } } },
      } }),
    });
    // Jeton expiré ou app désinstallée : on l’oublie.
    if (res.status === 404 || res.status === 400) {
      const err = await res.text();
      if (/UNREGISTERED|INVALID_ARGUMENT/.test(err)) await query('delete from push_tokens where token = $1', [t.token]);
    }
  }
}
