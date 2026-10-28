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
  // Tally sync: small key/value state (connector heartbeat, book stock snapshot, signal URL)
  await raw(`CREATE TABLE IF NOT EXISTS cst_tally_state (
    k           text PRIMARY KEY,
    v           jsonb NOT NULL,
    updated_at  bigint NOT NULL
  )`);
  // Which Tally stock item each counted cable spec belongs to
  await raw(`CREATE TABLE IF NOT EXISTS cst_tally_map (
    key         text PRIMARY KEY,
    tally_item  text NOT NULL,
    updated_by  text NOT NULL DEFAULT '',
    updated_at  bigint NOT NULL
  )`);
  // Work for the Tally PC connector: pull book stock, post Physical Stock
  await raw(`CREATE TABLE IF NOT EXISTS cst_tally_jobs (
    id          text PRIMARY KEY,
    type        text NOT NULL,
    count_id    text,
    as_of       text NOT NULL DEFAULT '',
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    status      text NOT NULL,
    result      jsonb,
    created_by  text NOT NULL DEFAULT '',
    created_at  bigint NOT NULL,
    updated_at  bigint NOT NULL
  )`);
}

/** Run a parameterised query, creating the tables on first use. Returns rows. */
export async function q(text, params = []) {
  if (!ready) ready = ensureSchema().catch(err => { ready = null; throw err; });
  await ready;
  return raw(text, params);
}
