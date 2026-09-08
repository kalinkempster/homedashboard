import { sql } from './_db.js';

// Birthdays live here rather than on a calendar feed because Google generates
// contact birthdays from the address book and never publishes them to iCal —
// the API can read them, a secret feed URL cannot. Storing month and day (no
// year) keeps them what they are: an annual date, not an instant.
//
//   GET                                   → { birthdays: [...] }
//   POST   { name, month, day, kind }     → add or update that person
//   DELETE { id }                         → remove

let ready = false;
async function ensureTable() {
  if (ready) return;
  await sql`create table if not exists birthdays (
    id    serial primary key,
    name  text not null,
    kind  text not null default 'birthday',
    month integer not null check (month between 1 and 12),
    day   integer not null check (day between 1 and 31),
    unique (name, kind)
  )`;
  ready = true;
}

export default async function handler(req, res) {
  await ensureTable();

  if (req.method === 'GET') {
    const birthdays = await sql`select * from birthdays order by month, day, name`;
    return res.json({ birthdays });
  }

  if (req.method === 'POST') {
    const { name, month, day, kind } = req.body || {};
    const clean = (name || '').trim();
    const m = parseInt(month, 10), d = parseInt(day, 10);
    if (!clean) return res.status(400).json({ error: 'name required' });
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
      return res.status(400).json({ error: 'month 1-12 and day 1-31 required' });
    }
    const k = kind === 'anniversary' ? 'anniversary' : 'birthday';

    const [row] = await sql`
      insert into birthdays (name, kind, month, day) values (${clean}, ${k}, ${m}, ${d})
      on conflict (name, kind) do update set month = ${m}, day = ${d}
      returning *`;
    return res.json(row);
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    await sql`delete from birthdays where id = ${id}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
}
