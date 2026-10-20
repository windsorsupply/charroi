// Fichiers envoyés (photos de marchandises, preuves, documents) :
// disque local par défaut, ou S3 / Cloudflare R2 si configuré (recommandé en production).
// Public : /files/pub/<id>. Privé : référence « priv:<id> », servie par une URL signée et temporaire.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { fail } from './services/common.js';

const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 5 * 1024 * 1024;

let s3 = null;
async function s3client() {
  if (!s3) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const c = config.s3;
    s3 = new S3Client({ region: c.region, endpoint: c.endpoint, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
  }
  return s3;
}

async function put(id, buf, mime) {
  if (config.s3) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3client()).send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: id, Body: buf, ContentType: mime }));
  } else {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, id), buf);
  }
}

export async function read(id) {
  if (!/^[a-z0-9-]+\.(jpg|png|webp)$/.test(id)) return null;
  if (config.s3) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const r = await (await s3client()).send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: id }));
      return Buffer.from(await r.Body.transformToByteArray());
    } catch (_) { return null; }
  }
  const p = path.join(config.uploadsDir, id);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

// Enregistre une image envoyée en « data URL » (déjà compressée par l’app).
export async function save(c, user, dataUrl, opts = {}) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) fail('BAD_FILE');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX) fail('FILE_TOO_BIG');
  const id = `${crypto.randomUUID()}.${MIME[m[1]]}`;
  const scope = opts.priv ? (opts.docs ? 'docs' : 'shared') : 'pub';
  await put(id, buf, m[1]);
  await c.query('insert into files (id, owner_id, private, scope, mime, size) values ($1,$2,$3,$4,$5,$6)', [id, user.id, !!opts.priv, scope, m[1], buf.length]);
  return opts.priv ? `priv:${id}` : `/files/pub/${id}`;
}

// Vérifie que les fichiers référencés appartiennent bien à la personne (empêche de
// « s’approprier » le fichier d’un autre pour obtenir une URL signée).
export async function ownRefs(c, user, refs, { priv = false, allowAdmin = true } = {}) {
  const out = [];
  for (const r of (refs || []).filter(Boolean)) {
    const s = String(r);
    const id = priv ? s.replace(/^priv:/, '') : s.replace(/^.*\/files\/pub\//, '');
    if (priv && !s.startsWith('priv:')) fail('BAD_FILE');
    if (!priv && !/\/files\/pub\//.test(s)) fail('BAD_FILE');
    const f = (await c.query('select owner_id, private from files where id = $1', [id])).rows[0];
    if (!f || f.private !== priv) fail('BAD_FILE');
    if (f.owner_id !== user.id && !(allowAdmin && user.role === 'admin') && priv) fail('BAD_FILE');
    out.push(priv ? `priv:${id}` : `/files/pub/${id}`);
  }
  return out;
}

const sig = (id, exp) => crypto.createHmac('sha256', config.fileSecret).update(`${id}.${exp}`).digest('hex').slice(0, 32);

// URL temporaire (1 h) pour un fichier privé que la personne a le droit de voir.
export const signedUrl = (ref) => {
  const id = String(ref).replace(/^priv:/, '');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `/files/priv/${id}?e=${exp}&s=${sig(id, exp)}`;
};
export const checkSig = (id, e, s) => Number(e) > Date.now() / 1000 && typeof s === 'string' && s.length === 32 &&
  crypto.timingSafeEqual(Buffer.from(sig(id, Number(e))), Buffer.from(s));
