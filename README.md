# Sprint Tracker

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

- Sprint boundaries are computed automatically from a fixed anchor date, so
  any date always maps to the same sprint number — no manual sprint setup.
- **Today view**: pick a date (defaults to today), add tasks. Each task
  records its start time when created; hitting "Done" records the end time
  and the elapsed duration. Optional comment per task. Running total for
  the day is shown at the top.
- **Sprints view**: every sprint, expandable to show each day worked in it,
  the tasks done that day (with comments), and totals per day and per
  sprint.
- **Today's Meetings**: the Today view automatically shows that day's Google
  Calendar events — no manual sync needed. See setup below.

Data lives in `data/sprint-tracker.db` (SQLite, gitignored).

## Google Calendar setup

Uses your calendar's private iCal feed rather than full OAuth — no Google
Cloud project or consent screen needed.

1. Open [Google Calendar](https://calendar.google.com) → Settings (gear
   icon) → **Settings** → click your calendar under "Settings for my
   calendars" → **Integrate calendar**.
2. Copy the **Secret address in iCal format** URL. Treat it like a
   password — anyone with it can read your calendar.
3. `cp .env.example .env` and paste the URL as `GOOGLE_CALENDAR_ICS_URL`.
4. Restart the server.

The server pulls this feed automatically every 15 minutes in the
background (there's also a ↻ button on the Today view to refresh
immediately). Without the URL configured, the panel just shows a
"not configured" message instead of failing.

Note: Google itself can take anywhere from a few minutes up to a few hours
to reflect calendar changes in this feed — it's not instant like the main
Calendar API.
