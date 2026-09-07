import { sql } from './_db.js';

// GET /api/history                    → newest page across every job
// GET /api/history?taskId=3           → newest page for one job
// GET /api/history?before=<iso>       → the page older than that timestamp
//
// Split out of /api/tasks so the 60s poll stops dragging the whole log across
// the wire, and so the History tab can page back instead of silently stopping
// at whatever the cap happened to be.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const q = req.query || {};
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 60, 1), 200);
  const taskId = q.taskId ? Number(q.taskId) : null;
  const before = q.before ? new Date(q.before) : null;
  if (before && isNaN(before)) return res.status(400).json({ error: 'before must be a timestamp' });

  // One row past the page size tells us whether there's more without a count(*).
  const rows = await sql`
    select h.id, h.task_id, h.at, h.by_who, h.kind, t.name
    from history h join tasks t on t.id = h.task_id
    where (${taskId}::int is null or h.task_id = ${taskId})
      and (${before ? before.toISOString() : null}::timestamptz is null
           or h.at < ${before ? before.toISOString() : null}::timestamptz)
    order by h.at desc
    limit ${limit + 1}`;

  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;

  res.json({
    history: page,
    hasMore: more,
    nextBefore: page.length ? new Date(page[page.length - 1].at).toISOString() : null
  });
}
