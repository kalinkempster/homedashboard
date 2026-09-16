import webpush from 'web-push';
import { sql, TZ, daysUntil, daysSince, todayKey, localHour } from './_db.js';

webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'nobody@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const SEND_HOUR = 7;    // 7am, household time
const BIN_HOUR = 18;    // fallback if the calendar entry carries no time
const QUIET_START = 22; // never send past 10pm, even if a trigger arrives late

// Sends one payload to every registered device, reporting what happened to
// each. Dead or mismatched endpoints are removed so the list self-heals:
//   404 / 410 — the browser dropped the subscription (uninstalled, cleared data)
//   403       — signed with a different VAPID key than the one it registered with
async function pushToAll(subs, payload) {
  return Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      return { who: s.who, ok: true };
    } catch (err) {
      const code = err.statusCode;
      let removed = false;
      if (code === 403 || code === 404 || code === 410) {
        await sql`delete from subscriptions where endpoint = ${s.endpoint}`;
        removed = true;
      }
      return {
        who: s.who,
        ok: false,
        status: code || null,
        removed,
        reason: code === 403 ? 'VAPID key mismatch — this device registered against a different key and must tap Allow again'
              : code === 404 || code === 410 ? 'subscription expired — device must tap Allow again'
              : (err.body || err.message || 'unknown').toString().slice(0, 200)
      };
    }
  }));
}

// Claims today's send slot. Returns false if some earlier trigger already took
// it, which is what lets this endpoint be hit every hour without sending twice.
// Keyed on the household's calendar day, not the server's.
async function claimToday(day) {
  await sql`create table if not exists run_log (
    day date primary key,
    at  timestamptz not null default now()
  )`;
  const rows = await sql`
    insert into run_log (day) values (${day}::date)
    on conflict (day) do nothing returning day`;
  return rows.length > 0;
}

// The bin reminder goes out in the evening and the chore digest in the morning,
// so they need separate claims — a shared one would let whichever ran first
// silence the other for the rest of the day. Its own table rather than a
// composite key, so the existing run_log never has to be rebuilt.
async function claimBinsToday(day) {
  await sql`create table if not exists bin_log (
    day date primary key,
    at  timestamptz not null default now()
  )`;
  const rows = await sql`
    insert into bin_log (day) values (${day}::date)
    on conflict (day) do nothing returning day`;
  return rows.length > 0;
}

// Reads the bins entry straight off the calendar endpoint, so the colours and
// the night they go out have exactly one source: the family calendar.
async function binsDueToday(today, req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const r = await fetch(proto + '://' + host + '/api/calendar');
  if (!r.ok) throw new Error('calendar responded ' + r.status);
  const d = await r.json();
  if (!d.bins || d.bins.date !== today) return null;
  return d.bins;
}

// Triggered hourly (GitHub Actions) with Vercel's daily cron as a fallback, and
// sends on the first trigger at or after 7am household time. Gating on the hour
// here rather than on the cron expression is what keeps delivery at 7am through
// a daylight saving change, since a fixed UTC cron can only be right half the
// year. The day-claim makes the extra triggers free.
//
// A job is pinged the day it falls due, then every 3 days while it stays overdue.
//   ?force=1 — ignore the send window and the once-a-day claim (for testing)
//   ?test=1  — send one test notification to every device and report per-device status
export default async function handler(req, res) {
  const q = req.query || {};
  const force = q.force === '1';
  const subs = await sql`select * from subscriptions order by id`;

  // Private reminders are routed by the name a phone registered under, so it
  // has to be possible to check that mapping without firing a notification to
  // find out. Names and counts only — never an endpoint or key.
  if (q.devices === '1') {
    const byName = {};
    for (const s of subs) byName[s.who || 'unknown'] = (byName[s.who || 'unknown'] || 0) + 1;
    const owners = await sql`
      select owner, count(*)::int as jobs from tasks
      where archived = false and owner is not null group by owner`;
    return res.json({
      phonesByName: byName,
      privateJobsByOwner: Object.fromEntries(owners.map(o => [o.owner, o.jobs])),
      unroutable: owners.filter(o => !byName[o.owner]).map(o => o.owner)
    });
  }

  if (q.test === '1') {
    const results = await pushToAll(subs, {
      title: 'Home Dashboard',
      body: 'Test alert — notifications are working.'
    });
    return res.json({ mode: 'test', devices: subs.length, results });
  }

  const hour = localHour();
  const today = todayKey();
  let binResult = { sent: false, reason: 'not checked' };

  // Bins first: it's an evening job on whatever night the calendar names, so it
  // has nothing to do with the morning digest below and must be checked even
  // once that has already claimed the day.
  if (q.bins !== '0') {
    try {
      const bins = await binsDueToday(today, req);
      if (bins) {
        const binHour = bins.time ? parseInt(bins.time.slice(0, 2), 10) : BIN_HOUR;
        const ready = hour >= binHour && hour < QUIET_START;
        if ((ready || force) && (force || await claimBinsToday(today))) {
          const list = bins.colours.join(', ');
          const results = await pushToAll(subs, {
            title: 'Bins out tonight',
            body: list + ' — out on the street for the morning.',
            tag: 'bins'
          });
          binResult = { sent: true, colours: bins.colours, results };
        } else {
          binResult = { sent: false, reason: ready ? 'already sent today' : 'before ' + binHour + ':00', colours: bins.colours };
        }
      } else {
        binResult = { sent: false, reason: 'no bins tonight' };
      }
    } catch (err) {
      binResult = { sent: false, reason: 'error: ' + (err.message || 'unknown') };
    }
  }

  if (!force) {
    if (hour < SEND_HOUR || hour >= QUIET_START) {
      return res.json({ skipped: 'outside the send window', bins: binResult, hour, sendHour: SEND_HOUR, timezone: TZ });
    }
    if (!(await claimToday(today))) {
      return res.json({ skipped: 'already sent today', bins: binResult, day: today, hour, timezone: TZ });
    }
  }

  const tasks = await sql`select * from tasks where archived = false`;

  // Work out everything owing first, then send once. One push per job meant a
  // morning with six overdue jobs produced six separate buzzes in a row.
  const due = [];
  for (const task of tasks) {
    const d = daysUntil(task);
    if (d > 0) continue;

    // First ping the day it comes due; afterwards only once every 3 days.
    // Driven by last_pinged rather than the overdue count, so a missed run
    // doesn't skip the reminder entirely. Still per-job, so a job you were
    // pinged about yesterday stays out of today's list.
    const sinceLastPing = daysSince(task.last_pinged);
    if (sinceLastPing !== null && sinceLastPing < 3) continue;

    due.push({ task, overdueBy: -d });
  }

  if (!due.length) {
    return res.json({ sent: [], bins: binResult, devices: subs.length, day: today, hour, timezone: TZ });
  }

  const label = e => e.overdueBy === 0
    ? 'due today'
    : e.overdueBy + ' day' + (e.overdueBy === 1 ? '' : 's') + ' overdue';

  const digestFor = items => {
    // Worst first — that's the order they're worth dealing with.
    items.sort((a, b) => b.overdueBy - a.overdueBy);
    // Long bodies get truncated by the OS, so name a handful and count the rest.
    const shown = items.slice(0, 5);
    const rest = items.length - shown.length;
    return items.length === 1
      ? {
          title: items[0].task.name,
          body: label(items[0]).charAt(0).toUpperCase() + label(items[0]).slice(1),
          taskId: items[0].task.id,
          tag: 'digest'
        }
      : {
          title: items.length + ' jobs need doing',
          body: shown.map(e => e.task.name + ' · ' + label(e)).join('\n')
                + (rest ? '\n+ ' + rest + ' more' : ''),
          tag: 'digest'
        };
  };

  // A private job goes only to its owner's devices, so each person gets the
  // household's jobs plus their own and never hears about anyone else's.
  const shared = due.filter(e => !e.task.owner);
  const owned = new Map();
  for (const e of due) {
    if (!e.task.owner) continue;
    if (!owned.has(e.task.owner)) owned.set(e.task.owner, []);
    owned.get(e.task.owner).push(e);
  }

  const devicesFor = new Map();
  for (const s of subs) {
    const key = s.who || 'unknown';
    if (!devicesFor.has(key)) devicesFor.set(key, []);
    devicesFor.get(key).push(s);
  }

  // Only stamp a job once it has actually been sent to someone. A private job
  // whose owner has no registered phone stays unstamped and is retried, rather
  // than being quietly marked as reminded.
  const stamped = new Set();
  const results = [];

  for (const [person, theirDevices] of devicesFor) {
    const items = shared.concat(owned.get(person) || []);
    if (!items.length) continue;
    const payload = digestFor(items);
    const r = await pushToAll(theirDevices, payload);
    for (const e of items) stamped.add(e.task.id);
    results.push({ who: person, notification: payload, devices: r });
  }

  for (const id of stamped) {
    await sql`update tasks set last_pinged = ${today}::date where id = ${id}`;
  }

  const unreachable = due.filter(e => !stamped.has(e.task.id))
    .map(e => ({ task: e.task.name, owner: e.task.owner, reason: 'no phone registered to that name' }));

  res.json({
    sent: due.filter(e => stamped.has(e.task.id)).map(e => e.task.name),
    notSent: unreachable,
    bins: binResult,
    devices: subs.length, day: today, hour, timezone: TZ, results
  });
}
