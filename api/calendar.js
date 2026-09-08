import { occurrences, todayISO, addDaysISO } from './_ics.js';

// Two secret iCal feeds, read server-side so the URLs never reach a phone.
//   BIRTHDAYS_ICS_URL — the calendar the contact birthdays sit on
//   FAMILY_ICS_URL    — the shared family calendar
const FEEDS = {
  birthdays: process.env.BIRTHDAYS_ICS_URL,
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

// Google writes contact birthdays as "<name>'s birthday" / "'s anniversary".
// Keeping the person's name and dropping the noun reads better on a banner.
function person(summary) {
  const m = summary.match(/^(.*?)['’]s (birthday|anniversary)$/i);
  return m ? { who: m[1], kind: m[2].toLowerCase() } : { who: summary, kind: 'birthday' };
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

  await Promise.all(Object.entries(FEEDS).map(async ([name, url]) => {
    if (!url) { out.sources[name] = 'not configured'; return; }
    try {
      const items = occurrences(await feed(url), today, until);
      if (name === 'birthdays') {
        // The birthday calendar is the personal one, so keep only the entries
        // that are actually birthdays and anniversaries.
        out.birthdays = items
          .filter(e => /['’]s (birthday|anniversary)$/i.test(e.summary))
          .map(e => ({ ...person(e.summary), date: e.date }));
      } else {
        out.events = items.map(e => ({
          summary: e.summary, date: e.date, time: e.time, allDay: e.allDay
        }));
      }
      out.sources[name] = 'ok';
    } catch (err) {
      out.sources[name] = 'error: ' + (err.message || 'unknown');
    }
  }));

  // Short cache at the edge too, so both phones polling don't each wake a lambda.
  res.setHeader('cache-control', 'public, max-age=300, stale-while-revalidate=900');
  res.json(out);
}
