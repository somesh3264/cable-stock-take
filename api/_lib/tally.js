import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { q } from './db.js';

/* Shared Tally helpers. groupKey, pieceQty and unitBasis are mirrored in app.js; keep them identical. */

export const norm = v => String(v == null ? '' : v).trim().toLowerCase();

/** One key per cable spec, so many drums/coils of the same cable map to one Tally item. */
export function groupKey(l) {
  const len = l.pack === 'Coil' ? (l.origM != null ? l.origM : l.perM) : '';
  return [l.make, l.type, l.conductor, l.cores, l.size, l.insulation, l.colour, len == null ? '' : len]
    .map(norm).join('|');
}

export const pieceQty = l => (l.pack === 'Coil' && Number(l.qty) > 1 ? Number(l.qty) : 1);

const METRE_UNITS = new Set(['m', 'mt', 'mts', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres', 'rmt', 'rm', 'lm', 'rmtr']);
const WEIGHT_UNITS = new Set(['kg', 'kgs', 'g', 'gm', 'gms', 'gram', 'grams', 'ton', 'tons', 'tonne', 'tonnes', 'qtl', 'mg']);

/** How a Tally unit is counted: metres, a count of pieces (rolls, coils, nos), or weight (not supported). */
export function unitBasis(unit) {
  const s = norm(unit).replace(/[^a-z]/g, '');
  if (!s) return 'count';
  if (METRE_UNITS.has(s)) return 'metres';
  if (WEIGHT_UNITS.has(s)) return 'weight';
  return 'count';
}

const round3 = n => Math.round(n * 1000) / 1000;

/** Turn counted lines into Physical Stock entries, one per matched Tally item. */
export function buildEntries(lines, maps, items) {
  const groups = new Map();
  for (const l of lines) {
    const k = groupKey(l);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  const mapByKey = new Map(maps.map(m => [m.key, m.item]));
  const itemByName = new Map(items.map(i => [i.name, i]));
  const entries = new Map();
  const unmatched = [];
  const problems = [];
  for (const [k, ls] of groups) {
    const name = mapByKey.get(k);
    if (!name) { unmatched.push(k); continue; }
    const it = itemByName.get(name);
    if (!it) { problems.push({ key: k, item: name, reason: 'not in the latest Tally item list' }); continue; }
    const basis = unitBasis(it.unit);
    if (basis === 'weight') { problems.push({ key: k, item: name, reason: 'Tally counts it by weight (' + it.unit + ')' }); continue; }
    const qty = basis === 'metres'
      ? ls.reduce((a, l) => a + (Number(l.lengthM) || 0), 0)
      : ls.reduce((a, l) => a + pieceQty(l), 0);
    const e = entries.get(name) || { item: name, unit: it.unit, basis, qty: 0, book: it.qty };
    e.qty += qty;
    entries.set(name, e);
  }
  return {
    entries: [...entries.values()].map(e => Object.assign(e, { qty: round3(e.qty) })),
    unmatched,
    problems,
  };
}

export async function getState(k) {
  const r = await q('SELECT v FROM cst_tally_state WHERE k = $1', [k]);
  return r.length ? r[0].v : null;
}

export async function setState(k, v) {
  await q(
    `INSERT INTO cst_tally_state (k, v, updated_at) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at`,
    [k, JSON.stringify(v), Date.now()]
  );
}

let signalOverride = null;
/** Test hook: replace the blob write. */
export function setSignalForTests(fn) { signalOverride = fn; }

/**
 * Tell the connector there is work. It watches a tiny public blob file on the CDN,
 * so it can wait for work without waking the database. Failure is not fatal: the
 * connector still checks in every hour.
 */
export async function signalAgent() {
  const body = JSON.stringify({ seq: Date.now() });
  try {
    let url = null;
    if (signalOverride) {
      url = await signalOverride(body);
    } else {
      if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) return null;
      const { put } = await import('@vercel/blob');
      const b = await put('tally/signal.json', body, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 3600,
        contentType: 'application/json',
      });
      url = b.url;
    }
    if (url) {
      const prev = await getState('signal');
      if (!prev || prev.url !== url) await setState('signal', { url });
    }
    return url;
  } catch (err) {
    console.error('Tally signal failed', err);
    return null;
  }
}

/*
 * Connector key. The app creates it and hands it out once inside config.json; only its
 * SHA-256 hash is stored. TALLY_SYNC_KEY in the environment also works, as an override.
 */
const sha256 = s => createHash('sha256').update(String(s)).digest();

export function newAgentKey() {
  const key = 'cst_' + randomBytes(32).toString('base64url');
  return { key, hash: sha256(key).toString('hex') };
}

export async function agentKeyState() {
  const s = await getState('agentKey');
  return s && s.hash ? s : null;
}

export async function agentKeyOk(got) {
  got = String(got || '');
  if (!got) return false;
  const env = process.env.TALLY_SYNC_KEY || '';
  if (env) {
    const a = Buffer.from(got), b = Buffer.from(env);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  const s = await agentKeyState();
  if (!s) return false;
  const want = Buffer.from(s.hash, 'hex');
  const have = sha256(got);
  return want.length === have.length && timingSafeEqual(want, have);
}

export async function syncConfigured() {
  return !!process.env.TALLY_SYNC_KEY || !!(await agentKeyState());
}

export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
