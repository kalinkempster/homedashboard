import { sql } from './_db.js';

// The regulars — the things that turn up on the shop again and again, kept as
// one-tap chips so the weekly basics never have to be retyped. Seeded from the
// last five Coles orders, editable afterwards.
//
//   GET                    → { staples: [...] }  (most-bought first)
//   POST   { name, rank }  → add or re-rank
//   DELETE { id }          → remove

let ready = false;
async function ensureTable() {
  if (ready) return;
  await sql`create table if not exists staples (
    id   serial primary key,
    name text not null unique,
    rank integer not null default 100
  )`;
  ready = true;
}

export default async function handler(req, res) {
  await ensureTable();

  if (req.method === 'GET') {
    const staples = await sql`select * from staples order by rank, name`;
    return res.json({ staples });
  }

  if (req.method === 'POST') {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    if (name.length > 60) return res.status(400).json({ error: 'name too long' });
    const rank = Number.isFinite(+req.body?.rank) ? +req.body.rank : 100;
    const [row] = await sql`
      insert into staples (name, rank) values (${name}, ${rank})
      on conflict (name) do update set rank = ${rank} returning *`;
    return res.json(row);
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    await sql`delete from staples where id = ${id}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
}
