import webpush from 'web-push';
import { sql, daysUntil } from './_db.js';

webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'nobody@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const TZ = process.env.HOUSEHOLD_TZ || 'Australia/Melbourne';
const QUIET_START = 22; // 10pm
const QUIET_END = 7;    // 7am

function localHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()));
}

function daysSince(date) {
  if (!date) return null;
  const then = new Date(date); then.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - then) / 86400000);
}

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

// Runs once a day at 21:00 UTC — 7am in Melbourne during AEST, 8am during AEDT.
// A job is pinged the day it falls due, then every 3 days while it stays overdue.
//   ?force=1 — ignore the quiet-hours guard (for testing)
//   ?test=1  — send one test notification to every device and report per-device status
export default async function handler(req, res) {
  const q = req.query || {};
  const subs = await sql`select * from subscriptions order by id`;

  if (q.test === '1') {
    const results = await pushToAll(subs, {
      title: 'Home Dashboard',
      body: 'Test alert — notifications are working.'
    });
    return res.json({ mode: 'test', devices: subs.length, results });
  }

  const hour = localHour();
  if ((hour >= QUIET_START || hour < QUIET_END) && q.force !== '1') {
    return res.json({ skipped: 'quiet hours', hour, timezone: TZ });
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

    await sql`update tasks set last_pinged = current_date where id = ${task.id}`;
    sent.push(task.name);
  }

  res.json({ sent, devices: subs.length, hour, timezone: TZ, results });
}
