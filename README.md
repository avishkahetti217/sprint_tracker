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

Data lives in `data/sprint-tracker.db` (SQLite, gitignored).
