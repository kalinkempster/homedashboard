import { occurrences, todayISO, addDaysISO } from './_ics.js';
import { sql } from './_db.js';

// The family calendar comes from a secret iCal feed, read server-side so the
// URL never reaches a phone. Birthdays do not: Google builds those from the
// address book and never publishes them to a feed, so they live in our own
// table instead. See api/birthdays.js.
const FEEDS = {
  family: process.env.FAMILY_ICS_URL
};

const WINDOW_DAYS = 45;
const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();

// Google's feeds are slow and rate-limited, and the dashboard polls. A warm
// lambda serves from memory; a cold one pays the fetch once.
async function feed(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;

  const res = await fetch(url, { headers: { accept: 'text/calendar' } });
  if (!res.ok) throw new Error('feed responded ' + res.status);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('that URL did not return a calendar');

  cache.set(url, { at: Date.now(), text });
  return text;
}

// The next time this month-and-day comes round, on or after today. Stored
// without a year, so the only question is whether it has already passed.
function nextOccurrence(todayStr, month, day) {
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const year = (month > tm || (month === tm && day >= td)) ? ty : ty + 1;
  // 29 February in a common year is marked on the 28th rather than skipped —
  // a birthday banner that vanishes for three years is not what anyone wants.
  const d = (month === 2 && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCDate() !== 29) ? 28 : day;
  return year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Reports the shape of each feed without publishing its contents. The personal
// calendar holds far more than birthdays and this endpoint is unauthenticated,
// so summaries are reduced to their last few characters — enough to see whether
// anything ends in "'s birthday", not enough to read the calendar.
async function describe() {
  const out = {};
  for (const [name, url] of Object.entries(FEEDS)) {
    if (!url) { out[name] = 'not configured'; continue; }
    try {
      const text = await feed(url);
      const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
      const summaries = [];
      for (const b of blocks) {
        const m = b.match(/\nSUMMARY[^:]*:([^\r\n]*)/i);
        if (m) summaries.push(m[1].trim());
      }
      out[name] = {
        bytes: text.length,
        events: blocks.length,
        withRecurrence: (text.match(/\nRRULE/gi) || []).length,
        endingInBirthday: summaries.filter(s => /birthday$/i.test(s)).length,
        endingInAnniversary: summaries.filter(s => /anniversary$/i.test(s)).length,
        containingBirthday: summaries.filter(s => /birthday/i.test(s)).length,
        tailSamples: summaries.slice(0, 8).map(s => (s.length > 14 ? '…' : '') + s.slice(-14))
      };
    } catch (err) {
      out[name] = 'error: ' + (err.message || 'unknown');
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  if ((req.query || {}).debug === '1') {
    res.setHeader('cache-control', 'no-store');
    return res.json({ diagnostics: await describe() });
  }

  const today = todayISO();
  const until = addDaysISO(today, WINDOW_DAYS);
  const out = { today, birthdays: [], events: [], sources: {} };

  const jobs = Object.entries(FEEDS).map(async ([name, url]) => {
    if (!url) { out.sources[name] = 'not configured'; return; }
    try {
      out.events = occurrences(await feed(url), today, until).map(e => ({
        summary: e.summary, date: e.date, time: e.time, allDay: e.allDay
      }));
      out.sources[name] = 'ok';
    } catch (err) {
      out.sources[name] = 'error: ' + (err.message || 'unknown');
    }
  });

  jobs.push((async () => {
    try {
      const rows = await sql`select * from birthdays`;
      out.birthdays = rows
        .map(r => ({ who: r.name, kind: r.kind, date: nextOccurrence(today, r.month, r.day) }))
        .filter(b => b.date <= until)
        .sort((a, b) => a.date.localeCompare(b.date));
      out.sources.birthdays = 'ok';
    } catch (err) {
      out.sources.birthdays = 'error: ' + (err.message || 'unknown');
    }
  })());

  await Promise.all(jobs);

  // Short cache at the edge, so both phones polling don't each wake a lambda —
  // but short enough that editing a birthday shows up while you're still looking.
  res.setHeader('cache-control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(out);
}
