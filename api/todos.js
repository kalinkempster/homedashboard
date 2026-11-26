import { sql, todayKey, dayKey } from './_db.js';

// One-off tasks, as opposed to the recurring jobs in `tasks`. A to-do is done
// once and then it's finished — there's no interval, no streak, no next time.
//
//   owner     null means both of you; a name means it's theirs alone
//   due_date  null means open-ended: on the list, but nothing is chasing you
//
// Ownership works the way it does for jobs: enforced on the server, and an
// unscoped read returns only the shared ones rather than everything.

let ready = false;
async function ensureTable() {
  if (ready) return;
  await sql`create table if not exists todos (
    id          serial primary key,
    title       text not null,
    owner       text,
    due_date    date,
    done        boolean not null default false,
    done_by     text,
    done_at     timestamptz,
    created_by  text,
    created_at  timestamptz not null default now(),
    last_pinged date
  )`;
  ready = true;
}

export default async function handler(req, res) {
  await ensureTable();
  const who = (req.query || {}).who || null;

  if (req.method === 'GET') {
    // Open ones always; finished ones only for the last week, so the list
    // shows what you've just done without becoming an archive.
    const rows = who
      ? await sql`
          select * from todos
          where (owner is null or owner = ${who})
            and (done = false or done_at > now() - interval '7 days')
          order by done asc, due_date asc nulls last, created_at asc`
      : await sql`
          select * from todos
          where owner is null
            and (done = false or done_at > now() - interval '7 days')
          order by done asc, due_date asc nulls last, created_at asc`;
    return res.json({ todos: rows, today: todayKey() });
  }

  if (req.method === 'POST') {
    const { title, owner, due_date, who: by } = req.body || {};
    const clean = (title || '').trim();
    if (!clean) return res.status(400).json({ error: 'title required' });
    if (clean.length > 200) return res.status(400).json({ error: 'title too long' });
    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
      return res.status(400).json({ error: 'due_date must be YYYY-MM-DD' });
    }
    const [row] = await sql`
      insert into todos (title, owner, due_date, created_by)
      values (${clean}, ${owner || null}, ${due_date || null}::date, ${by || null})
      returning *`;
    return res.json(row);
  }

  if (req.method === 'PATCH') {
    const { id, done, title, owner, due_date, who: by } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });

    if ('done' in req.body) {
      // Finishing clears last_pinged so that re-opening one starts its
      // reminders over rather than inheriting a stale "already told you".
      const [row] = await sql`
        update todos set
          done    = ${!!done},
          done_by = ${done ? (by || null) : null},
          done_at = ${done ? new Date().toISOString() : null}::timestamptz,
          last_pinged = null
        where id = ${id} returning *`;
      return res.json(row);
    }

    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
      return res.status(400).json({ error: 'due_date must be YYYY-MM-DD' });
    }
    // Each optional field is its own statement, because "leave this alone"
    // and "set this to null" are different intentions and coalesce can't tell
    // them apart — clearing a due date has to be possible.
    if ('owner' in req.body) {
      await sql`update todos set owner = ${owner || null} where id = ${id}`;
    }
    if ('due_date' in req.body) {
      await sql`update todos set due_date = ${due_date || null}::date where id = ${id}`;
    }
    const [row] = await sql`
      update todos set title = coalesce(${title ?? null}, title)
      where id = ${id} returning *`;
    return res.json(row);
  }

  if (req.method === 'DELETE') {
    const { id, clearDone } = req.body || {};
    if (clearDone) {
      const rows = who
        ? await sql`delete from todos where done = true and (owner is null or owner = ${who}) returning id`
        : await sql`delete from todos where done = true and owner is null returning id`;
      return res.json({ cleared: rows.length });
    }
    if (!id) return res.status(400).json({ error: 'id or clearDone required' });
    await sql`delete from todos where id = ${id}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
}
