import { sql, daysUntil } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const tasks = await sql`select * from tasks order by id`;
    const withDue = tasks.map(t => ({ ...t, days_until: daysUntil(t) }));

    // History moved to /api/history so the 60s poll stays small. `?history=1`
    // keeps an already-installed copy of the app working until it refreshes.
    if ((req.query || {}).history === '1') {
      const history = await sql`select * from history order by at desc limit 500`;
      return res.json({ tasks: withDue, history });
    }
    return res.json({ tasks: withDue });
  }

  if (req.method === 'POST') {
    const { name, interval_days } = req.body;
    if (!name || !interval_days) return res.status(400).json({ error: 'name and interval_days required' });
    const [row] = await sql`
      insert into tasks (name, interval_days, last_done)
      values (${name}, ${interval_days}, current_date) returning *`;
    return res.json(row);
  }

  if (req.method === 'PATCH') {
    const { id, interval_days, notes, last_done, archived, snoozed_to } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    if ('snoozed_to' in req.body) {
      await sql`update tasks set snoozed_to = ${snoozed_to ?? null}::date where id = ${id}`;
    }

    const [row] = await sql`
      update tasks set
        interval_days = coalesce(${interval_days ?? null}, interval_days),
        notes         = coalesce(${notes ?? null}, notes),
        last_done     = coalesce(${last_done ?? null}::date, last_done),
        archived      = coalesce(${archived ?? null}, archived)
      where id = ${id} returning *`;
    return res.json(row);
  }

  res.status(405).end();
}
