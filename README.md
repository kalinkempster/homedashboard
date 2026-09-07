# Home Dashboard

Deployed on Vercel at **homedashboard-peach.vercel.app**. Setup instructions: see
SETUP.md in the design project.

## Layout

- `design/Home Dashboard.dc.html` — the interface, as authored. This is the source
  of record; `public/index.html` is generated from it.
- `build.mjs` — regenerates `public/index.html` and `public/support.js`. Run
  `node build.mjs` after editing the canvas file, then commit `public/`.
- `public/support.js` — the canvas runtime the page loads.
- `public/sw.js` — service worker: caches the app shell so it opens with no
  signal, and receives push.
- `api/tasks.js` — list / add / update jobs.
- `api/history.js` — the log, paged, for the History tab and the detail view.
- `api/complete.js` — tick, skip, snooze, undo.
- `api/subscribe.js` — registers a phone for push.
- `api/check-due.js` — the reminder run.
- `schema.sql` — tables plus the seeded job list, for a fresh database.
- `migrate.sql` — brings an existing database up to date.

## Reminders

`/api/check-due` is poked every hour by `.github/workflows/daily-check.yml`, and
sends on the first poke at or after **7am household time**, claiming the day in
`run_log` so the other 23 pokes do nothing. A job is pinged the day it falls due,
then every 3 days while it stays overdue.

The hourly poke is what holds 7am steady across daylight saving. Vercel's Hobby
plan allows one cron a day at a fixed UTC time, and Melbourne moves between
UTC+10 and UTC+11, so a cron alone can only be right for half the year. The
Vercel cron in `vercel.json` (21:00 UTC) stays on as a fallback for when GitHub
pauses the workflow, which it does after 60 days without a commit.

Testing: `?force=1` ignores the send window and the once-a-day claim; `?test=1`
sends one test notification to every registered device and reports what each
push service said.

## Timezones

`HOUSEHOLD_TZ` is the only clock that matters. Vercel runs in UTC, so every date
comparison goes through the helpers in `api/_db.js` rather than through the
server's own calendar — at the 7am Melbourne send time the server's date is
still yesterday, which previously pushed every reminder a day late.

The interface falls back to on-device state if `/api/tasks` isn't reachable, so
the canvas file still works as a standalone prototype.
