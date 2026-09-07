import { sql, daysUntil, todayKey, dayKey } from './_db.js';

// The history row carries the state it replaced, so an undo restores exactly
// what was there rather than guessing from what's left behind.
let migrated = false;
async function ensureColumns() {
  if (migrated) return;
  await sql`alter table history add column if not exists prev_last_done date`;
  await sql`alter table history add column if not exists prev_last_done_by text`;
  await sql`alter table history add column if not exists prev_streak integer`;
  await sql`alter table history add column if not exists prev_last_pinged date`;
  migrated = true;
}

// Body: { id, who, kind: 'done' | 'skipped' | 'snooze' | 'undo', historyId? }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id, who, kind = 'done', historyId } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  await ensureColumns();

  const [task] = await sql`select * from tasks where id = ${id}`;
  if (!task) return res.status(404).json({ error: 'no such task' });

  if (kind === 'undo') {
    // Undo the caller's own action. Without an explicit historyId — an older
    // client, or a retry — fall back to the newest row, which is right except
    // when the other phone has acted on the same job in between.
    const [entry] = historyId
      ? await sql`select * from history where id = ${historyId} and task_id = ${id}`
      : await sql`select * from history where task_id = ${id} order by at desc limit 1`;

    if (!entry) {
      const [unchanged] = await sql`select * from tasks where id = ${id}`;
      return res.json({ task: unchanged, undone: false });
    }

    await sql`delete from history where id = ${entry.id}`;

    const [row] = await sql`
      update tasks set
        last_done    = ${dayKey(entry.prev_last_done)}::date,
        last_done_by = ${entry.prev_last_done_by ?? null},
        streak       = ${entry.prev_streak ?? 0},
        snoozed_to   = null,
        last_pinged  = ${dayKey(entry.prev_last_pinged)}::date
      where id = ${id} returning *`;
    return res.json({ task: row, undone: true });
  }

  if (kind === 'snooze') {
    const [row] = await sql`
      update tasks set snoozed_to = ${todayKey()}::date + 1, last_pinged = ${todayKey()}::date
      where id = ${id} returning *`;
    return res.json({ task: row });
  }

  const onTime = daysUntil(task) >= 0;
  const streak = kind === 'done' ? (onTime ? task.streak + 1 : 0) : 0;
  const today = todayKey();

  const [entry] = await sql`
    insert into history (task_id, by_who, kind, prev_last_done, prev_last_done_by, prev_streak, prev_last_pinged)
    values (${id}, ${kind === 'done' ? who : null}, ${kind},
            ${dayKey(task.last_done)}::date, ${task.last_done_by},
            ${task.streak}, ${dayKey(task.last_pinged)}::date)
    returning *`;

  const [row] = await sql`
    update tasks set
      last_done    = ${today}::date,
      last_done_by = ${kind === 'done' ? who : null},
      streak       = ${streak},
      snoozed_to   = null,
      last_pinged  = null
    where id = ${id} returning *`;

  res.json({ task: row, historyId: entry.id });
}
