import { q, dbConfigured } from './_lib/db.js';
import { send, bad, str } from './_lib/http.js';
import { getState, setState, todayIST, agentKeyOk, syncConfigured } from './_lib/tally.js';

/* Endpoint for the connector running on the Tally PC. Authenticated by the connector key, not the team PIN. */

const STALE_RUNNING_MS = 15 * 60 * 1000;
const QUEUE_EXPIRY_MS = 24 * 3600 * 1000;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function agentInfo(a) {
  a = a && typeof a === 'object' ? a : {};
  return {
    version: str(a.version, 20),
    company: str(a.company, 200),
    godown: str(a.godown, 120),
    tallyOk: a.tallyOk === true,
    tallyError: str(a.tallyError, 300),
    tallyCheckedAt: num(a.tallyCheckedAt) || null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!dbConfigured()) return send(res, 503, { error: 'no_db', message: 'The app database is not connected.' });
    if (!(await syncConfigured())) {
      return send(res, 503, { error: 'not_configured', message: 'No connector key yet. Create one in the app: Tally tab, Create connector file.' });
    }
    if (!(await agentKeyOk(req.headers['x-sync-key']))) {
      return send(res, 401, { error: 'key', message: 'Connector key not accepted. It may have been replaced in the app. Download a new config.json from the Tally tab.' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { error: 'method', message: 'Use POST.' });
    }

    const b = req.body || {};
    const now = Date.now();
    const prev = (await getState('agent')) || {};
    await setState('agent', Object.assign({}, prev, b.agent ? agentInfo(b.agent) : {}, { lastSeen: now }));

    if (b.action === 'poll') {
      await q(`UPDATE cst_tally_jobs SET status = 'expired', updated_at = $1 WHERE status = 'queued' AND created_at < $2`, [now, now - QUEUE_EXPIRY_MS]);
      await q(
        `UPDATE cst_tally_jobs SET status = 'error', result = $3::jsonb, updated_at = $1 WHERE status = 'running' AND updated_at < $2`,
        [now, now - STALE_RUNNING_MS, JSON.stringify({ message: 'The connector stopped before finishing. Check the Day Book in Tally before posting again.' })]
      );
      // While the connector can't reach Tally it leaves jobs queued and only learns how many are waiting.
      const claim = b.claim !== false;
      const jobs = claim
        ? await q(
          `UPDATE cst_tally_jobs SET status = 'running', updated_at = $1 WHERE status = 'queued'
           RETURNING id, type, count_id, as_of, payload, created_at`,
          [now]
        )
        : [];
      const waiting = claim ? 0 : Number((await q(`SELECT count(*)::int AS n FROM cst_tally_jobs WHERE status = 'queued'`))[0].n);
      const latest = await q(`SELECT count_date FROM cst_counts WHERE status = 'open' ORDER BY created_at DESC LIMIT 1`);
      const signal = await getState('signal');
      return send(res, 200, {
        waiting,
        jobs: jobs
          .sort((x, y) => Number(x.created_at) - Number(y.created_at))
          .map(j => ({ id: j.id, type: j.type, countId: j.count_id, asOf: j.as_of, payload: j.payload || {} })),
        autoPullAsOf: (latest[0] && isDate(latest[0].count_date) && latest[0].count_date) || todayIST(),
        signalUrl: (signal && signal.url) || null,
        now,
      });
    }

    if (b.action === 'snapshot') {
      if (!Array.isArray(b.items)) return bad(res, 'items missing');
      const items = b.items.slice(0, 20000).map(i => ({
        name: str(i && i.name, 300),
        parent: str(i && i.parent, 200),
        unit: str(i && i.unit, 40),
        qty: num(i && i.qty),
        value: num(i && i.value),
        text: str(i && i.text, 80),
      })).filter(i => i.name);
      const asOf = isDate(b.asOf) ? b.asOf : todayIST();
      await setState('snapshot', { asOf, company: str(b.company, 200), pulledAt: now, items });
      const jobId = str(b.jobId, 40);
      if (jobId) {
        await q(
          `UPDATE cst_tally_jobs SET status = 'done', result = $2::jsonb, updated_at = $3 WHERE id = $1`,
          [jobId, JSON.stringify({ items: items.length, asOf, message: `Pulled ${items.length} items from Tally` }), now]
        );
      }
      return send(res, 200, { ok: true, items: items.length });
    }

    if (b.action === 'result') {
      const jobId = str(b.jobId, 40);
      if (!jobId) return bad(res, 'jobId missing');
      const status = ['done', 'warning', 'error'].includes(b.status) ? b.status : 'error';
      let result = JSON.stringify(b.result && typeof b.result === 'object' ? b.result : {});
      if (result.length > 200000) result = JSON.stringify({ message: 'Result too large to store', truncated: true });
      await q(`UPDATE cst_tally_jobs SET status = $2, result = $3::jsonb, updated_at = $4 WHERE id = $1`, [jobId, status, result, now]);
      return send(res, 200, { ok: true });
    }

    return bad(res, 'Unknown action.');
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'server', message: 'Something went wrong on the server. Try again in a moment.' });
  }
}
