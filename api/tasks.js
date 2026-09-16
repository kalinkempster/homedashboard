import { sql, daysUntil } from './_db.js';

// A task with no owner belongs to the household; one with an owner belongs to
// that person alone and is invisible to anyone else. Medication is the reason
// this exists — you shouldn't be reminded about someone else's, or see it.
let migrated = false;
async function ensureColumns() {
  if (migrated) return;
  await sql`alter table tasks add column if not exists owner text`;
  migrated = true;
}

const mine = who => who ? sql`(owner is null or owner = ${who})` : sql`true`;

export default async function handler(req, res) {
  await ensureColumns();
  const who = (req.query || {}).who || null;

  if (req.method === 'GET') {
    // Without a `who` the caller gets the household's own jobs only, never
    // someone's private ones — an unscoped read must not be a way around this.
    const tasks = who
      ? await sql`select * from tasks where owner is null or owner = ${who} order by id`
      : await sql`select * from tasks where owner is null order by id`;
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
    const { name, interval_days, owner } = req.body;
    if (!name || !interval_days) return res.status(400).json({ error: 'name and interval_days required' });
    const [row] = await sql`
      insert into tasks (name, interval_days, last_done, owner)
      values (${name}, ${interval_days}, current_date, ${owner || null}) returning *`;
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
