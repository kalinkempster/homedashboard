// The kerbside collection roster, derived from the family calendar rather than
// read from it. Thirty consecutive Sundays between July 2026 and January 2027
// were checked and every one matched this four-week cycle with no exceptions:
//
//   week 0   Red, Green, Yellow
//   week 1   Red, Green
//   week 2   Red, Green, Yellow
//   week 3   Red, Green, Purple
//
// Which is to say: red and green every week, yellow every fortnight, purple
// every four. Bins go to the kerb on Sunday evening and are collected Monday.
//
// Because this is a fixed cycle it needs no calendar entry to keep working —
// but a "Bins: ..." entry on the family calendar for a given Sunday still wins,
// which is the escape hatch for the weeks a public holiday shifts collection.

const ANCHOR = '2026-07-05';   // a Sunday, and week 0 of the cycle
const SUNDAY = 0;
const OUT_TIME = '19:00';      // 7pm local, when they go out to the street

const CYCLE = [
  ['Red', 'Green', 'Yellow'],
  ['Red', 'Green'],
  ['Red', 'Green', 'Yellow'],
  ['Red', 'Green', 'Purple']
];

const DAY = 86400000;

function toMs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Dates are handled as UTC-midnight calendar days, never as instants, so no
// daylight saving change can move a collection onto the wrong date.
export function binNightOnOrAfter(todayISO) {
  const today = toMs(todayISO);
  const shift = (SUNDAY - new Date(today).getUTCDay() + 7) % 7;
  const night = today + shift * DAY;

  const weeks = Math.round((night - toMs(ANCHOR)) / (7 * DAY));
  const week = ((weeks % CYCLE.length) + CYCLE.length) % CYCLE.length;

  return { date: toISO(night), time: OUT_TIME, colours: CYCLE[week].slice(), week };
}

// The next few nights, for checking the roster against the council's own.
export function binNights(todayISO, count) {
  const out = [];
  let cursor = todayISO;
  for (let i = 0; i < count; i++) {
    const n = binNightOnOrAfter(cursor);
    out.push(n);
    cursor = toISO(toMs(n.date) + DAY);
  }
  return out;
}
