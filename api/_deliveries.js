// Recurring deliveries, computed rather than read from the calendar — the same
// move as the bin roster. Both series were checked against the family calendar
// from July 2026 to January 2027 and repeat without a break:
//
//   Hello Fresh   every Sunday          (20 consecutive weeks checked)
//   Dog food      every second Sunday   (15 consecutive deliveries checked)
//
// They share an anchor because 6 September 2026 falls in both series.
//
// Encoding them here is what lets the calendar entries be deleted: the dates
// keep coming, and they survive the feed being unreachable.

const DAY = 86400000;

export const DELIVERIES = [
  { name: 'Hello Fresh',  every: 7,  anchor: '2026-09-06' },
  { name: 'Raw & Fresh',  every: 14, anchor: '2026-09-06' }
];

function toMs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// The next arrival on or after `todayISO`. Counting whole periods from the
// anchor keeps every date on the same weekday, whatever daylight saving does.
function nextFrom(series, todayISO) {
  const anchor = toMs(series.anchor);
  const step = series.every * DAY;
  const n = Math.max(Math.ceil((toMs(todayISO) - anchor) / step), 0);
  return new Date(anchor + n * step).toISOString().slice(0, 10);
}

export function upcomingDeliveries(todayISO) {
  return DELIVERIES
    .map(s => ({ name: s.name, date: nextFrom(s, todayISO), every: s.every }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.every - b.every);
}

// The next `count` arrivals across every series, merged into one timeline.
// Each series contributes `count` of its own before the merge, so the prefix
// is complete however far apart the two cadences are.
export function deliverySchedule(todayISO, count) {
  const out = [];
  for (const s of DELIVERIES) {
    let date = nextFrom(s, todayISO);
    for (let i = 0; i < count; i++) {
      out.push({ name: s.name, date, every: s.every });
      date = new Date(toMs(date) + s.every * DAY).toISOString().slice(0, 10);
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return out.slice(0, count);
}
