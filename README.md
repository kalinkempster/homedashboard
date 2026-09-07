# Home Dashboard

Deployed on Vercel. Setup instructions: see SETUP.md in the project root.

- `public/index.html` — the whole interface, one self-contained file. Built from
  `Home Dashboard.dc.html` in the design project; edit there and re-export, don't hand-edit this.
- `public/sw.js` — service worker, receives push and shows the notification.
- `api/tasks.js` — list / add / update jobs.
- `api/complete.js` — tick, skip, snooze, undo.
- `api/subscribe.js` — registers a phone for push.
- `api/check-due.js` — the cron job. Runs hourly, sends at 7am local, silent 10pm–7am.
  Pings the day a job falls due, then every 3 days while overdue.
- `schema.sql` — tables plus the seeded job list.

The interface falls back to on-device state if `/api/tasks` isn't reachable, so it still
works as a prototype when opened as a plain file.
