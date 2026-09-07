import webpush from 'web-push';
import { sql, daysUntil } from './_db.js';

webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'nobody@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const TZ = process.env.HOUSEHOLD_TZ || 'Europe/London';
const QUIET_START = 22; // 10pm
const QUIET_END = 7;    // 7am

function localHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()));
}

// Runs hourly (see vercel.json). Pings a task the day it falls due,
// then every 3 days while it stays overdue. Silent 10pm-7am.
export default async function handler(req, res) {
  const hour = localHour();
  if (hour >= QUIET_START || hour < QUIET_END) return res.json({ skipped: 'quiet hours', hour });
  if (hour !== QUIET_END) return res.json({ skipped: 'not the daily send hour', hour });

  const tasks = await sql`select * from tasks where archived = false`;
  const subs = await sql`select * from subscriptions`;
  const sent = [];

  for (const task of tasks) {
    const d = daysUntil(task);
    if (d > 0) continue;

    const overdueBy = -d;
    const firstPing = overdueBy === 0;
    const repeat = overdueBy > 0 && overdueBy % 3 === 0;
    if (!firstPing && !repeat) continue;

    const pingedToday = task.last_pinged && new Date(task.last_pinged).toDateString() === new Date().toDateString();
    if (pingedToday) continue;

    const body = firstPing
      ? 'Due today'
      : overdueBy + ' day' + (overdueBy === 1 ? '' : 's') + ' overdue';

    await Promise.all(subs.map(s =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: task.name, body, taskId: task.id })
      ).catch(async err => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await sql`delete from subscriptions where endpoint = ${s.endpoint}`;
        }
      })
    ));

    await sql`update tasks set last_pinged = current_date where id = ${task.id}`;
    sent.push(task.name);
  }

  res.json({ sent, devices: subs.length });
}
