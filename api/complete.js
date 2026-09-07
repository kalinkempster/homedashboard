import { sql, daysUntil } from './_db.js';

// Body: { id, who, kind: 'done' | 'skipped' | 'snooze' | 'undo' }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id, who, kind = 'done' } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const [task] = await sql`select * from tasks where id = ${id}`;
  if (!task) return res.status(404).json({ error: 'no such task' });

  if (kind === 'undo') {
    // Drop the newest history row and roll last_done back to the one before it.
    const [latest] = await sql`select id from history where task_id = ${id} order by at desc limit 1`;
    if (latest) await sql`delete from history where id = ${latest.id}`;
    const [prev] = await sql`select at, by_who from history where task_id = ${id} order by at desc limit 1`;
    const [row] = await sql`
      update tasks set
        last_done    = ${prev ? new Date(prev.at).toISOString().slice(0, 10) : null}::date,
        last_done_by = ${prev ? prev.by_who : null},
        streak       = greatest(streak - 1, 0),
        snoozed_to   = null,
        last_pinged  = null
      where id = ${id} returning *`;
    return res.json(row);
  }

  if (kind === 'snooze') {
    const [row] = await sql`
      update tasks set snoozed_to = current_date + 1, last_pinged = current_date
      where id = ${id} returning *`;
    return res.json(row);
  }

  const onTime = daysUntil(task) >= 0;
  const streak = kind === 'done' ? (onTime ? task.streak + 1 : 0) : 0;

  const [row] = await sql`
    update tasks set
      last_done    = current_date,
      last_done_by = ${kind === 'done' ? who : null},
      streak       = ${streak},
      snoozed_to   = null,
      last_pinged  = null
    where id = ${id} returning *`;

  await sql`insert into history (task_id, by_who, kind) values (${id}, ${kind === 'done' ? who : null}, ${kind})`;
  res.json(row);
}
