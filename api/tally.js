import { randomUUID } from 'node:crypto';
import { q } from './_lib/db.js';
import { guard, send, bad, str } from './_lib/http.js';
import { buildEntries, getState, signalAgent, todayIST } from './_lib/tally.js';

const JOB_COLS = 'id, type, count_id, as_of, status, result, created_by, created_at, updated_at';
const mapJob = r => ({
  id: r.id,
  type: r.type,
  countId: r.count_id,
  asOf: r.as_of,
  status: r.status,
  result: r.result || null,
  by: r.created_by,
  at: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const newJobId = () => 'j_' + randomUUID().replace(/-/g, '').slice(0, 16);

async function loadMaps() {
  const rows = await q('SELECT key, tally_item FROM cst_tally_map');
  return rows.map(m => ({ key: m.key, item: m.tally_item }));
}

export default function handler(req, res) {
  return guard(req, res, async () => {
    if (req.method === 'GET') {
      const [agent, snapshot, maps, jobs] = await Promise.all([
        getState('agent'),
        getState('snapshot'),
        loadMaps(),
        q(`SELECT ${JOB_COLS} FROM cst_tally_jobs ORDER BY created_at DESC LIMIT 12`),
      ]);
      return send(res, 200, {
        configured: !!process.env.TALLY_SYNC_KEY,
        agent: agent || null,
        snapshot: snapshot || null,
        maps,
        jobs: jobs.map(mapJob),
        now: Date.now(),
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return send(res, 405, { error: 'method', message: 'Method not allowed.' });
    }

    const b = req.body || {};
    const action = str(b.action, 20);
    const by = str(b.by, 80);

    if (action === 'map') {
      const list = Array.isArray(b.maps) ? b.maps.slice(0, 2000) : [];
      const set = new Map();
      const del = new Set();
      for (const m of list) {
        const key = str(m && m.key, 400);
        if (!key) continue;
        const item = str(m && m.item, 300);
        if (item) { set.set(key, item); del.delete(key); } else { del.add(key); set.delete(key); }
      }
      if (!set.size && !del.size) return bad(res, 'Nothing to save.');
      const now = Date.now();
      if (set.size) {
        const rows = [...set].map(([key, item]) => ({ key, item }));
        await q(
          `INSERT INTO cst_tally_map (key, tally_item, updated_by, updated_at)
           SELECT x.key, x.item, $2, $3 FROM jsonb_to_recordset($1::jsonb) AS x(key text, item text)
           ON CONFLICT (key) DO UPDATE SET tally_item = EXCLUDED.tally_item, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          [JSON.stringify(rows), by, now]
        );
      }
      if (del.size) {
        await q('DELETE FROM cst_tally_map WHERE key IN (SELECT jsonb_array_elements_text($1::jsonb))', [JSON.stringify([...del])]);
      }
      return send(res, 200, { ok: true, saved: set.size, cleared: del.size, maps: await loadMaps() });
    }

    if (action === 'pull' || action === 'post') {
      const countId = str(b.count, 64);
      const counts = countId ? await q('SELECT id, name, count_date, status FROM cst_counts WHERE id = $1', [countId]) : [];
      if (!counts.length) return send(res, 404, { error: 'not_found', message: 'That count no longer exists.' });
      const c = counts[0];
      const asOf = /^\d{4}-\d{2}-\d{2}$/.test(c.count_date || '') ? c.count_date : todayIST();

      const busy = action === 'post'
        ? await q(`SELECT ${JOB_COLS} FROM cst_tally_jobs WHERE type = 'post' AND count_id = $1 AND status IN ('queued', 'running') LIMIT 1`, [countId])
        : await q(`SELECT ${JOB_COLS} FROM cst_tally_jobs WHERE type = 'pull' AND status IN ('queued', 'running') LIMIT 1`);
      if (busy.length) {
        if (action === 'pull') return send(res, 200, { job: mapJob(busy[0]), existing: true });
        return send(res, 409, { error: 'busy', message: 'A post to Tally for this count is already waiting. Let it finish first.' });
      }

      let payload = {};
      let summary;
      if (action === 'post') {
        const snapshot = await getState('snapshot');
        if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length) {
          return bad(res, 'Pull book stock from Tally first, so counted items can be matched to Tally items.');
        }
        const lineRows = await q('SELECT data FROM cst_lines WHERE count_id = $1', [countId]);
        const { entries, unmatched, problems } = buildEntries(lineRows.map(r => r.data), await loadMaps(), snapshot.items);
        if (!entries.length) return bad(res, 'No counted items are matched to Tally items yet. Match them first.');
        payload = {
          date: asOf,
          countName: c.name,
          remoteId: 'cst-' + countId,
          narration: `Stock take "${c.name}" from Cable Stock Take: ${entries.length} items`,
          entries: entries.map(e => ({ item: e.item, unit: e.unit, qty: e.qty, book: e.book })),
          skipped: { unmatched: unmatched.length, problems },
        };
        summary = { items: entries.length, unmatched: unmatched.length, problems: problems.length };
      }

      const id = newJobId();
      const now = Date.now();
      await q(
        `INSERT INTO cst_tally_jobs (id, type, count_id, as_of, payload, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', $6, $7, $7)`,
        [id, action, countId, asOf, JSON.stringify(payload), by, now]
      );
      const signalled = !!(await signalAgent());
      return send(res, 201, {
        job: { id, type: action, countId, asOf, status: 'queued', result: null, by, at: now, updatedAt: now },
        summary,
        signalled,
      });
    }

    if (action === 'cancel') {
      const id = str(b.id, 40);
      const r = await q(`UPDATE cst_tally_jobs SET status = 'cancelled', updated_at = $2 WHERE id = $1 AND status = 'queued' RETURNING id`, [id, Date.now()]);
      if (!r.length) return send(res, 409, { error: 'not_queued', message: 'That job has already started or finished.' });
      return send(res, 200, { ok: true });
    }

    return bad(res, 'Unknown action.');
  });
}
