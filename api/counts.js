import { randomUUID } from 'node:crypto';
import { q } from './_lib/db.js';
import { guard, send, bad, str } from './_lib/http.js';

const mapCount = r => ({
  id: r.id,
  name: r.name,
  site: r.site,
  date: r.count_date,
  status: r.status,
  by: r.created_by,
  at: Number(r.created_at),
  closedAt: r.closed_at == null ? null : Number(r.closed_at),
  closedBy: r.closed_by || null,
});

export default function handler(req, res) {
  return guard(req, res, async () => {
    if (req.method === 'GET') {
      const rows = await q('SELECT * FROM cst_counts ORDER BY created_at DESC LIMIT 200');
      return send(res, 200, { counts: rows.map(mapCount) });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const name = str(b.name, 120);
      if (!name) return bad(res, 'Give the count a name so others can find it.');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : '';
      const id = 'c_' + randomUUID().replace(/-/g, '').slice(0, 16);
      await q(
        'INSERT INTO cst_counts (id, name, site, count_date, status, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, name, str(b.site, 120), date, 'open', str(b.by, 80), Date.now()]
      );
      return send(res, 201, { id });
    }

    if (req.method === 'PATCH') {
      const id = str((req.query || {}).id, 64);
      const b = req.body || {};
      if (!id) return bad(res, 'Missing count id.');
      if (b.status !== 'open' && b.status !== 'closed') return bad(res, 'Status must be open or closed.');
      const closing = b.status === 'closed';
      const rows = await q(
        'UPDATE cst_counts SET status = $2, closed_at = $3, closed_by = $4 WHERE id = $1 RETURNING *',
        [id, b.status, closing ? Date.now() : null, closing ? str(b.by, 80) : null]
      );
      if (!rows.length) return send(res, 404, { error: 'not_found', message: 'That count no longer exists.' });
      return send(res, 200, { count: mapCount(rows[0]) });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return send(res, 405, { error: 'method', message: 'Method not allowed.' });
  });
}
