import { q } from './_lib/db.js';
import { guard, send, bad, str } from './_lib/http.js';

const LINE_ID = /^d_[A-Z0-9_\-.~:@+]{1,120}$/;
const STR = {
  tag: 40, pack: 20, type: 40, conductor: 20, cores: 10, size: 10, armour: 20, insulation: 20,
  make: 60, colour: 20, method: 20, location: 80, condition: 30, remarks: 500, by: 80,
};
const NUM = ['qty', 'markOuter', 'markInner', 'perM', 'lengthM', 'origM'];

function clean(d) {
  const o = {};
  for (const [k, max] of Object.entries(STR)) o[k] = str(d[k], max);
  for (const k of NUM) {
    const raw = d[k];
    const v = Number(raw);
    o[k] = raw === null || raw === undefined || raw === '' || !Number.isFinite(v) ? null : v;
  }
  o.qty = o.qty && o.qty >= 1 ? Math.floor(o.qty) : 1;
  o.tag = o.tag.toUpperCase();
  return o;
}

const toLine = r => Object.assign({}, r.data, { id: r.id });

export default function handler(req, res) {
  return guard(req, res, async () => {
    const query = req.query || {};
    const countId = str(query.count, 64);
    if (!countId) return bad(res, 'Missing count id.');

    if (req.method === 'GET') {
      const rows = await q('SELECT id, data FROM cst_lines WHERE count_id = $1 ORDER BY updated_at DESC', [countId]);
      return send(res, 200, { lines: rows.map(toLine) });
    }

    const id = str(query.id, 140);
    if (!LINE_ID.test(id)) return bad(res, 'That tag number has characters that cannot be saved.');

    const counts = await q('SELECT status FROM cst_counts WHERE id = $1', [countId]);
    if (!counts.length) return send(res, 404, { error: 'not_found', message: 'That count no longer exists.' });

    if (req.method === 'PUT') {
      if (counts[0].status === 'closed') return send(res, 409, { error: 'closed', message: 'This count is closed. Reopen it from Summary to add more.' });
      const b = req.body || {};
      const d = clean(b.data || {});
      if (!d.tag) return bad(res, 'Tag number is required.');
      if (d.lengthM == null || d.lengthM < 0) return bad(res, 'Length must be zero or more.');
      const now = Date.now();
      d.at = now;
      await q(
        `INSERT INTO cst_lines (count_id, id, data, updated_at) VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (count_id, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [countId, id, JSON.stringify(d), now]
      );
      const replaces = str(b.replaces, 140);
      if (replaces && replaces !== id && LINE_ID.test(replaces)) {
        await q('DELETE FROM cst_lines WHERE count_id = $1 AND id = $2', [countId, replaces]);
      }
      return send(res, 200, { line: Object.assign({}, d, { id }) });
    }

    if (req.method === 'DELETE') {
      if (counts[0].status === 'closed') return send(res, 409, { error: 'closed', message: 'This count is closed. Reopen it from Summary to change entries.' });
      await q('DELETE FROM cst_lines WHERE count_id = $1 AND id = $2', [countId, id]);
      return send(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'GET, PUT, DELETE');
    return send(res, 405, { error: 'method', message: 'Method not allowed.' });
  });
}
