import { sql } from './_db.js';

// The shared shopping list. Flat on purpose: an item is either still wanted or
// already in the trolley, and that is the whole model.
//
//   GET                            → { items: [...] }
//   POST   { name, who }           → add
//   PATCH  { id, done, who }       → tick or untick
//   DELETE { id } | { clearDone }  → remove one, or every ticked item

let ready = false;
async function ensureTable() {
  if (ready) return;
  await sql`create table if not exists grocery (
    id         serial primary key,
    name       text not null,
    done       boolean not null default false,
    added_by   text,
    done_by    text,
    created_at timestamptz not null default now(),
    done_at    timestamptz
  )`;
  ready = true;
}

export default async function handler(req, res) {
  await ensureTable();

  if (req.method === 'GET') {
    // Still-wanted items first, oldest at the top so the list reads in the
    // order things were thought of; ticked items sink to the bottom.
    const items = await sql`
      select * from grocery
      order by done asc, case when done then done_at else created_at end desc`;
    return res.json({ items });
  }

  if (req.method === 'POST') {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    if (name.length > 120) return res.status(400).json({ error: 'name too long' });

    // Re-adding something already on the list should revive it, not duplicate it.
    const [existing] = await sql`
      select * from grocery where lower(name) = lower(${name}) limit 1`;
    if (existing) {
      const [row] = await sql`
        update grocery set done = false, done_by = null, done_at = null, created_at = now()
        where id = ${existing.id} returning *`;
      return res.json(row);
    }

    const [row] = await sql`
      insert into grocery (name, added_by) values (${name}, ${req.body?.who || null}) returning *`;
    return res.json(row);
  }

  if (req.method === 'PATCH') {
    const { id, done, who } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const [row] = await sql`
      update grocery set
        done    = ${!!done},
        done_by = ${done ? (who || null) : null},
        done_at = ${done ? new Date().toISOString() : null}::timestamptz
      where id = ${id} returning *`;
    return res.json(row);
  }

  if (req.method === 'DELETE') {
    const { id, clearDone } = req.body || {};
    if (clearDone) {
      const rows = await sql`delete from grocery where done = true returning id`;
      return res.json({ cleared: rows.length });
    }
    if (!id) return res.status(400).json({ error: 'id or clearDone required' });
    await sql`delete from grocery where id = ${id}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
}
