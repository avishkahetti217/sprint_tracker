# Work Tracker

Single-user daily task tracker grouped into two-week sprints (Monday through
the Friday of the following week). Single Node/Express process, plain
HTML/JS frontend (no build step), SQLite file database.

## Run it

```
npm install
npm start
```

Open http://localhost:4100

## How it works

- Sprint boundaries (start/end date) are computed automatically from a fixed
  anchor date — no manual setup. A sprint number is *not* auto-assigned; it's
  an optional label you can add per period (✎ next to its date range in the
  Sprints view) if you want to track your own numbering.
- **Today view**: pick a date (defaults to today), add tasks. Each task
  records its start time when created; hitting "Done" records the end time
  and the elapsed duration. Optional comment per task. Running total for
  the day is shown at the top.
- **Sprints view**: every period (shown by date range, with its sprint
  number alongside if you've set one), expandable to show each day worked
  in it, the tasks done that day (with comments), and totals per day and
  per period.
- **Today's Meetings**: the Today view automatically shows that day's Google
  Calendar events — no manual sync needed. See setup below.

Data lives in `data/sprint-tracker.db` (SQLite, gitignored).

## Google Calendar setup

Managed entirely from the **Integrations** tab — no `.env` editing or
server restart needed. Uses your calendar's private iCal feed rather than
full OAuth, so there's no Google Cloud project or consent screen either.

1. Open [Google Calendar](https://calendar.google.com) → Settings (gear
   icon) → **Settings** → click your calendar under "Settings for my
   calendars" → **Integrate calendar**.
2. Copy the **Secret address in iCal format** URL. Treat it like a
   password — anyone with it can read your calendar.
3. In the app, go to **Integrations** → paste the URL → **Save**. To
   connect a different calendar later, just paste a new URL and save
   again; **Disconnect** removes it entirely.

The URL is stored in the database (`settings` table), not in a file. The
server pulls the feed automatically every 15 minutes in the background
(there's also a ↻ button on the Today view to refresh immediately).
Without a calendar linked, the panel just shows a "not linked" message
instead of failing.

Meetings pulled from the feed are also created as tasks (category
"Meetings") once they've actually ended — one that hasn't started yet, or
is still in progress, stays open and gets auto-completed on a later sync.

Note: Google itself can take anywhere from a few minutes up to a few hours
to reflect calendar changes in this feed — it's not instant like the main
Calendar API.

`GOOGLE_CALENDAR_ICS_URL` in `.env` is still supported as a one-time seed —
if set and no calendar is linked yet in the database, its value is copied
in on first startup so it shows up already-linked in Integrations. After
that, the database is the source of truth and `.env` is ignored.
