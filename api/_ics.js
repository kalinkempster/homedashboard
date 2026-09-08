// A small iCalendar reader — enough for Google's secret feeds, not a general
// implementation. It handles what those feeds actually contain: folded lines,
// all-day and timed events, and simple recurrence (the yearly repeat behind
// every birthday, the weekly repeat behind a delivery), with EXDATE removals
// and cancelled instances taken out.
//
// Dates are kept as calendar parts rather than instants, and stepped in
// calendar units, so a yearly repeat lands on the same date every year and no
// daylight saving change can shift it.

const TZ = process.env.HOUSEHOLD_TZ || 'Australia/Melbourne';

// Folded continuation lines begin with a space or tab and belong to the line above.
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function parseParams(raw) {
  const out = {};
  for (const part of raw.split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).toUpperCase()] = part.slice(i + 1).replace(/^"|"$/g, '');
  }
  return out;
}

// "20260909" or "20260913T090000" / "...Z"
function parseStamp(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const d = {
    y: +m[1], m: +m[2], d: +m[3],
    hh: m[4] === undefined ? null : +m[4],
    mm: m[5] === undefined ? null : +m[5],
    allDay: params.VALUE === 'DATE' || m[4] === undefined
  };
  // A UTC stamp is a real instant, so shift it into the household's day before
  // anything else looks at it — otherwise a 9am Melbourne event stored as
  // 23:00Z the day before shows up on the wrong date.
  if (m[7] === 'Z' && !d.allDay) return shiftToLocal(Date.UTC(d.y, d.m - 1, d.d, d.hh, d.mm));
  return d;
}

const LOCAL_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function shiftToLocal(ms) {
  const p = {};
  for (const part of LOCAL_FMT.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, allDay: false };
}

// Sortable YYYYMMDD, so window checks never build a Date.
const key = d => d.y * 10000 + d.m * 100 + d.d;
const iso = d => d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0');

function parseRule(value) {
  const r = {};
  for (const part of value.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) r[part.slice(0, i).toUpperCase()] = part.slice(i + 1);
  }
  return {
    freq: (r.FREQ || '').toUpperCase(),
    interval: Math.max(parseInt(r.INTERVAL, 10) || 1, 1),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL ? parseStamp(r.UNTIL.replace(/Z$/, ''), {}) : null
  };
}

// The nth repeat counted from the start date — not from the previous one, so a
// skipped instance can't end the series. Day-of-month is held steady, and an
// instance that lands on a date the month doesn't have (the 31st of November,
// the 29th of February in a common year) simply doesn't exist: RFC 5545 drops
// it rather than rolling it forward, and it doesn't count toward COUNT.
// Returns null for those, and the caller keeps walking.
function nth(d, freq, n) {
  if (freq === 'DAILY')  return addDays(d, n);
  if (freq === 'WEEKLY') return addDays(d, n * 7);
  if (freq === 'MONTHLY') {
    const total = (d.y * 12 + (d.m - 1)) + n;
    const y = Math.floor(total / 12), m = (total % 12) + 1;
    return daysIn(y, m) < d.d ? null : { ...d, y, m };
  }
  if (freq === 'YEARLY') {
    const y = d.y + n;
    return daysIn(y, d.m) < d.d ? null : { ...d, y };
  }
  return undefined; // unrecognised frequency — treat as non-recurring
}

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addDays(d, n) {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { ...d, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const m = line.match(/^([A-Za-z-]+)((?:;[^:]*)?):([\s\S]*)$/);
    if (!m) continue;
    const name = m[1].toUpperCase();
    const params = parseParams(m[2].replace(/^;/, ''));
    const value = m[3];

    if (name === 'DTSTART') { cur.start = parseStamp(value, params); cur.tzid = params.TZID || null; }
    else if (name === 'SUMMARY') cur.summary = unescapeText(value);
    else if (name === 'RRULE') cur.rule = parseRule(value);
    else if (name === 'STATUS') cur.status = value.trim().toUpperCase();
    else if (name === 'TRANSP') cur.transp = value.trim().toUpperCase();
    else if (name === 'RECURRENCE-ID') cur.recurrenceId = parseStamp(value, params);
    else if (name === 'EXDATE') {
      for (const v of value.split(',')) {
        const p = parseStamp(v.trim(), params);
        if (p) cur.exdates.push(key(p));
      }
    }
  }
  return events;
}

// Every occurrence between two YYYY-MM-DD bounds, soonest first.
export function occurrences(text, fromISO, toISO) {
  const from = +fromISO.replace(/-/g, '');
  const to = +toISO.replace(/-/g, '');
  const out = [];

  for (const ev of parseICS(text)) {
    if (!ev.start || !ev.summary) continue;
    if (ev.status === 'CANCELLED') continue;

    const push = d => {
      out.push({
        summary: ev.summary,
        date: iso(d),
        allDay: !!d.allDay,
        time: d.allDay || d.hh === null ? null
          : String(d.hh).padStart(2, '0') + ':' + String(d.mm).padStart(2, '0'),
        sort: key(d) * 10000 + (d.allDay || d.hh === null ? 0 : d.hh * 100 + d.mm)
      });
    };

    if (!ev.rule || !ev.rule.freq) {
      const k = key(ev.start);
      if (k >= from && k <= to) push(ev.start);
      continue;
    }

    // Walk the repeat forward. The cap is a safety net against a malformed rule
    // looping unbounded, not a real limit — even a leap-day birthday, which
    // skips three years in four, has centuries of headroom.
    const r = ev.rule;
    let emitted = 0;
    for (let n = 0; n < 4000; n++) {
      const d = nth(ev.start, r.freq, r.interval * n);
      if (d === undefined) { if (key(ev.start) >= from && key(ev.start) <= to) push(ev.start); break; }
      if (d === null) continue;      // a date this month doesn't have

      const k = key(d);
      if (r.until && k > key(r.until)) break;
      if (r.count !== null && emitted >= r.count) break;
      if (k > to) break;
      if (k >= from && !ev.exdates.includes(k)) push(d);
      emitted++;
    }
  }

  out.sort((a, b) => a.sort - b.sort);
  return out;
}

export function todayISO() {
  const p = {};
  for (const part of LOCAL_FMT.formatToParts(new Date())) p[part.type] = part.value;
  return p.year + '-' + p.month + '-' + p.day;
}

export function addDaysISO(isoStr, n) {
  const [y, m, d] = isoStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
