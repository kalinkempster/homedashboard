import { sql, daysUntil, todayKey } from './_db.js';

// A task with no owner belongs to the household; one with an owner belongs to
// that person alone and is invisible to anyone else. Medication is the reason
// this exists — you shouldn't be reminded about someone else's, or see it.
let migrated = false;
async function ensureColumns() {
  if (migrated) return;
  await sql`alter table tasks add column if not exists owner text`;
  await sql`alter table tasks add column if not exists anchor_date date`;
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
    const { name, interval_days, owner, mode, anchor_date, last_done } = req.body;
    if (!name || !interval_days) return res.status(400).json({ error: 'name and interval_days required' });

    // A cycle needs an anchor to count its dates from; without one it would
    // have no series, so fall back to the interval behaviour rather than
    // storing a mode that can't be honoured.
    const cycle = mode === 'cycle' && !!anchor_date;

    // An interval job starts its clock the day you add it. A cycle job takes
    // its dates from the anchor, so it must start with no last_done at all —
    // defaulting that to today would push the first one a whole period away.
    const started = last_done ?? (cycle ? null : todayKey());

    const [row] = await sql`
      insert into tasks (name, interval_days, last_done, owner, mode, anchor_date)
      values (
        ${name}, ${interval_days}, ${started}::date, ${owner || null},
        ${cycle ? 'cycle' : 'interval'}, ${cycle ? anchor_date : null}::date
      ) returning *`;
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

  // Archiving hides a job but keeps its record, which is right for something
  // you've stopped doing. This is for one that shouldn't have existed — it
  // takes the history with it, so it isn't the same button as Archive.
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const [gone] = await sql`delete from tasks where id = ${id} returning id, name`;
    if (!gone) return res.status(404).json({ error: 'no such task' });
    return res.json({ deleted: gone });
  }

  res.status(405).end();
}
