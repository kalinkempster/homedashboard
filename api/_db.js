import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

export const TZ = process.env.HOUSEHOLD_TZ || 'Australia/Melbourne';

// Everything here works in plain YYYY-MM-DD keys anchored at UTC midnight, so
// one day is always exactly 86400000ms and daylight saving can never shift a
// due date sideways.
const DAY = 86400000;

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
});

const HOUR_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', hourCycle: 'h23'
});

// A Postgres `date` arrives as a Date pinned to UTC midnight, so read it back
// in UTC — going through local parts would move the calendar day.
export function dayKey(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

// Today as the household sees it. Vercel runs in UTC, so at the 7am Melbourne
// send time the server's own date is still yesterday — deriving due-ness from
// it made every reminder fire a day late.
export function todayKey() {
  return DATE_FMT.format(new Date());
}

export function localHour() {
  return Number(HOUR_FMT.format(new Date()));
}

function keyToMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function msToKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dueKey(task) {
  const last = dayKey(task.last_done);
  if (!last) return todayKey();
  return msToKey(keyToMs(last) + task.interval_days * DAY);
}

export function daysUntil(task) {
  let due = keyToMs(dueKey(task));
  const snoozed = dayKey(task.snoozed_to);
  if (snoozed && keyToMs(snoozed) > due) due = keyToMs(snoozed);
  return Math.round((due - keyToMs(todayKey())) / DAY);
}

export function daysSince(value) {
  const key = dayKey(value);
  if (!key) return null;
  return Math.round((keyToMs(todayKey()) - keyToMs(key)) / DAY);
}
