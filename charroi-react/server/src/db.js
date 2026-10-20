// Accès à PostgreSQL : vrai serveur (DATABASE_URL) ou PGlite intégré pour le développement.
// Interface commune : query(sql, params) → { rows }, et tx(fn) pour une transaction.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';

let impl = null;

// Formats de retour : dates « AAAA-MM-JJ » en texte, nombres décimaux en nombres.
const DATE = 1082, NUMERIC = 1700, INT8 = 20;

async function openPg() {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(DATE, (v) => v);
  pg.types.setTypeParser(NUMERIC, (v) => (v == null ? null : parseFloat(v)));
  pg.types.setTypeParser(INT8, (v) => (v == null ? null : parseInt(v, 10)));
  const needSsl = !/localhost|127\.0\.0\.1/.test(config.databaseUrl) && !/sslmode=disable/.test(config.databaseUrl);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: needSsl ? { rejectUnauthorized: false } : false });
  return {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const r = await fn({ query: (t, p) => c.query(t, p), exec: (s) => c.query(s) });
        await c.query('commit');
        return r;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally { c.release(); }
    },
    close: () => pool.end(),
  };
}

async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const dir = config.pgliteDir === ':memory:' ? undefined : config.pgliteDir;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create({
    ...(dir ? { dataDir: dir } : {}),
    extensions: { btree_gist },
    parsers: { [DATE]: (v) => v, [NUMERIC]: (v) => (v == null ? null : parseFloat(v)), [INT8]: (v) => (v == null ? null : Number(v)) },
  });
  // PGlite n’a qu’une connexion : on met les transactions en file.
  let chain = Promise.resolve();
  const run = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  return {
    query: (text, params) => run(() => db.query(text, params)),
    tx: (fn) => run(() => db.transaction((t) => fn({ query: (q, p) => t.query(q, p), exec: (s) => t.exec(s) }))),
    close: () => db.close(),
  };
}

export async function connect() {
  if (impl) return impl;
  impl = config.databaseUrl ? await openPg() : await openPglite();
  console.log(config.databaseUrl ? '✓ PostgreSQL connecté' : `✓ PGlite (PostgreSQL intégré) : ${config.pgliteDir}`);
  await migrate();
  return impl;
}

export const query = (text, params) => impl.query(text, params);
export const tx = (fn) => impl.tx(fn);
export const one = async (text, params) => (await impl.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await impl.query(text, params)).rows;
export const close = () => impl && impl.close();

// Applique les fichiers server/migrations/*.sql pas encore exécutés.
async function migrate() {
  await impl.query('create table if not exists schema_migrations (name text primary key, at timestamptz not null default now())');
  const done = new Set((await impl.query('select name from schema_migrations')).rows.map((r) => r.name));
  const dir = path.join(ROOT, 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await impl.tx(async (c) => {
      await c.exec(sql);
      await c.query('insert into schema_migrations (name) values ($1)', [f]);
    });
    console.log('  migration appliquée :', f);
  }
}
