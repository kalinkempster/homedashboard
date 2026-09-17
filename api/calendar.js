import { occurrences, todayISO, addDaysISO } from './_ics.js';
import { sql } from './_db.js';
import { binNightOnOrAfter, binNights } from './_bins.js';
import { upcomingDeliveries, deliverySchedule } from './_deliveries.js';

// The family calendar comes from a secret iCal feed, read server-side so the
// URL never reaches a phone. Birthdays do not: Google builds those from the
// address book and never publishes them to a feed, so they live in our own
// table instead. See api/birthdays.js.
const FEEDS = {
  family: process.env.FAMILY_ICS_URL
};

// "Bins: Red, Green, Yellow" — the leading label is stripped and what's left
// is the list of lids going out.
const BIN_RE = /^\s*bins?\s*[:\-]\s*/i;

// Series the dashboard now works out for itself. They're kept out of the events
// list so nothing appears twice while the calendar entries are still there, and
// so the list only ever shows what genuinely lives on the calendar alone.
//   bins          → its own banner, from the four-week roster
//   hello fresh   → delivery in the deliveries banner; the order window is a job
//   dog food      → delivery in the deliveries banner, shown as "Raw & Fresh".
//                   This matches the calendar's own wording, not ours, so it
//                   keeps working however the banner labels it.
//   deworming     → a household job
const COVERED = [BIN_RE, /hello\s*fresh/i, /dog\s*food/i, /deworm/i];
const isCovered = summary => COVERED.some(re => re.test(summary));

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
  // The bin roster comes from the cycle, not the feed, so it survives the
  // calendar entries being retired — and still works if the feed is down.
  const out = {
    today, birthdays: [], events: [],
    bins: { ...binNightOnOrAfter(today), source: 'schedule' },
    deliveries: upcomingDeliveries(today),
    // Enough to answer "when's the one after next" without a second request.
    binsUpcoming: binNights(today, 8).map(n => ({ ...n, collection: addDaysISO(n.date, 1) })),
    deliveriesUpcoming: deliverySchedule(today, 12),
    sources: {}
  };

  const jobs = Object.entries(FEEDS).map(async ([name, url]) => {
    if (!url) { out.sources[name] = 'not configured'; return; }
    try {
      const items = occurrences(await feed(url), today, until);

      // The roster is a fixed cycle (see _bins.js), so the calendar isn't needed
      // to know which bins go out. A "Bins: ..." entry on the night we're
      // already showing still wins, though — that's the override for the weeks
      // a public holiday shifts collection.
      const override = items.find(e => BIN_RE.test(e.summary) && e.date === out.bins.date);
      if (override) {
        out.bins = {
          date: override.date,
          time: override.time || out.bins.time,
          colours: override.summary.replace(BIN_RE, '').split(/[,/]/)
            .map(c => c.trim()).filter(Boolean),
          source: 'calendar'
        };
        // Keep the list's first night agreeing with the banner above it.
        if (out.binsUpcoming[0] && out.binsUpcoming[0].date === out.bins.date) {
          out.binsUpcoming[0] = { ...out.binsUpcoming[0], colours: out.bins.colours, source: 'calendar' };
        }
      }

      out.events = items.filter(e => !isCovered(e.summary)).map(e => ({
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
