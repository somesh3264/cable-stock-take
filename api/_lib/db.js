import { neon } from '@neondatabase/serverless';

let sql = null;
let override = null;
let ready = null;

const connectionString = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

export const dbConfigured = () => !!override || !!connectionString();

/** Test hook: run queries through another Postgres (e.g. PGlite). */
export function setQueryForTests(fn) {
  override = fn;
  ready = null;
}

async function raw(text, params = []) {
  if (override) return override(text, params);
  if (!sql) sql = neon(connectionString());
  return sql.query(text, params);
}

async function ensureSchema() {
  await raw(`CREATE TABLE IF NOT EXISTS cst_counts (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    site        text NOT NULL DEFAULT '',
    count_date  text NOT NULL DEFAULT '',
    status      text NOT NULL DEFAULT 'open',
    created_by  text NOT NULL DEFAULT '',
    created_at  bigint NOT NULL,
    closed_at   bigint,
    closed_by   text
  )`);
  await raw(`CREATE TABLE IF NOT EXISTS cst_lines (
    count_id    text NOT NULL REFERENCES cst_counts(id) ON DELETE CASCADE,
    id          text NOT NULL,
    data        jsonb NOT NULL,
    updated_at  bigint NOT NULL,
    PRIMARY KEY (count_id, id)
  )`);
}

/** Run a parameterised query, creating the tables on first use. Returns rows. */
export async function q(text, params = []) {
  if (!ready) ready = ensureSchema().catch(err => { ready = null; throw err; });
  await ready;
  return raw(text, params);
}
