import webpush from 'web-push';
import { sql, TZ, daysUntil, daysSince, todayKey, localHour } from './_db.js';

webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'nobody@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const SEND_HOUR = 7;   // 7am, household time
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

  if (q.test === '1') {
    const results = await pushToAll(subs, {
      title: 'Home Dashboard',
      body: 'Test alert — notifications are working.'
    });
    return res.json({ mode: 'test', devices: subs.length, results });
  }

  const hour = localHour();
  const today = todayKey();

  if (!force) {
    if (hour < SEND_HOUR || hour >= QUIET_START) {
      return res.json({ skipped: 'outside the send window', hour, sendHour: SEND_HOUR, timezone: TZ });
    }
    if (!(await claimToday(today))) {
      return res.json({ skipped: 'already sent today', day: today, hour, timezone: TZ });
    }
  }

  const tasks = await sql`select * from tasks where archived = false`;
  const sent = [];
  const results = [];

  for (const task of tasks) {
    const d = daysUntil(task);
    if (d > 0) continue;

    const overdueBy = -d;
    const sinceLastPing = daysSince(task.last_pinged);

    // First ping the day it comes due; afterwards only once every 3 days.
    // Driven by last_pinged rather than the overdue count, so a missed run
    // doesn't skip the reminder entirely.
    if (sinceLastPing !== null && sinceLastPing < 3) continue;

    const body = overdueBy === 0
      ? 'Due today'
      : overdueBy + ' day' + (overdueBy === 1 ? '' : 's') + ' overdue';

    const r = await pushToAll(subs, { title: task.name, body, taskId: task.id });
    results.push({ task: task.name, devices: r });

    await sql`update tasks set last_pinged = ${today}::date where id = ${task.id}`;
    sent.push(task.name);
  }

  res.json({ sent, devices: subs.length, day: today, hour, timezone: TZ, results });
}
