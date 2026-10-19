require('dotenv').config();
const path = require('path');
const express = require('express');
const ical = require('node-ical');
const db = require('./db');
const { toDateKey, parseDateKey, computeSprintForDate } = require('./sprint-math');

const TASK_CATEGORIES = [
  'Research',
  'Story writing',
  'Demo',
  'Sanity testing',
  'Presentations',
  'Meetings',
  'Adhoc',
  'Support',
  'Domain learning',
  'Documentation',
];

const NOTE_CATEGORIES = ['Challenges', 'Achievements', 'Mistakes', 'Learnings'];

const OBJECTIVE_STATUSES = ['To Do', 'In Progress', 'Done'];
const OBJECTIVE_PRIORITIES = ['High', 'Medium', 'Low'];

const app = express();
const PORT = process.env.PORT || 4100;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getOrCreateSprint(dateKey) {
  const { startDate, endDate } = computeSprintForDate(dateKey);
  let sprint = db.prepare('SELECT * FROM sprints WHERE start_date = ?').get(startDate);
  if (!sprint) {
    const info = db
      .prepare('INSERT INTO sprints (sprint_number, start_date, end_date) VALUES (NULL, ?, ?)')
      .run(startDate, endDate);
    sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(info.lastInsertRowid);
  }
  return sprint;
}

function getOrCreateDay(dateKey) {
  let day = db.prepare('SELECT * FROM days WHERE date = ?').get(dateKey);
  if (!day) {
    const sprint = getOrCreateSprint(dateKey);
    const info = db
      .prepare('INSERT INTO days (sprint_id, date, created_at) VALUES (?, ?, ?)')
      .run(sprint.id, dateKey, new Date().toISOString());
    day = db.prepare('SELECT * FROM days WHERE id = ?').get(info.lastInsertRowid);
  }
  return day;
}

// A task left open (never marked done, no end_time set) on a day that has
// already ended is auto-closed with a default 1-hour duration, so it doesn't
// linger open indefinitely just because the day moved on without it.
const DEFAULT_STALE_TASK_DURATION_SECONDS = 60 * 60;

function closeStaleOpenTasks() {
  const todayKey = toDateKey(new Date());
  const staleTasks = db
    .prepare(
      `SELECT t.id, t.start_time FROM tasks t
       JOIN days d ON d.id = t.day_id
       WHERE t.status = 'open' AND d.date < ?`
    )
    .all(todayKey);

  if (staleTasks.length === 0) return;

  const close = db.prepare("UPDATE tasks SET end_time = ?, duration_seconds = ?, status = 'done' WHERE id = ?");
  staleTasks.forEach((t) => {
    const start = new Date(t.start_time);
    const end = new Date(start.getTime() + DEFAULT_STALE_TASK_DURATION_SECONDS * 1000);
    close.run(end.toISOString(), DEFAULT_STALE_TASK_DURATION_SECONDS, t.id);
  });
}

function subtasksForTask(taskId) {
  return db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position').all(taskId);
}

function tasksForDay(dayId) {
  const tasks = db.prepare('SELECT * FROM tasks WHERE day_id = ? ORDER BY id').all(dayId);
  return tasks.map((t) => ({ ...t, subtasks: subtasksForTask(t.id) }));
}

function totalSeconds(tasks) {
  return tasks.reduce((sum, t) => sum + (t.status === 'cancelled' ? 0 : t.duration_seconds || 0), 0);
}

function goalsForDay(dayId) {
  return db.prepare('SELECT * FROM goals WHERE day_id = ? ORDER BY position').all(dayId);
}

const MAX_GOALS_PER_DAY = 3;

// GET a day (creating it + its sprint on first access), with its tasks and goals.
app.get('/api/day', (req, res) => {
  closeStaleOpenTasks();
  const dateKey = req.query.date || toDateKey(new Date());
  const day = getOrCreateDay(dateKey);
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(day.sprint_id);
  const tasks = tasksForDay(day.id);
  const goals = goalsForDay(day.id);
  res.json({ day, sprint, tasks, totalSeconds: totalSeconds(tasks), goals });
});

// Add a goal to a day (max 3).
app.post('/api/days/:dayId/goals', (req, res) => {
  const dayId = Number(req.params.dayId);
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(dayId);
  if (!day) return res.status(404).json({ error: 'day not found' });

  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  const existing = goalsForDay(dayId);
  if (existing.length >= MAX_GOALS_PER_DAY) {
    return res.status(400).json({ error: `a day can have at most ${MAX_GOALS_PER_DAY} goals` });
  }

  const position = existing.length ? Math.max(...existing.map((g) => g.position)) + 1 : 1;
  const info = db
    .prepare('INSERT INTO goals (day_id, text, done, position) VALUES (?, ?, 0, ?)')
    .run(dayId, text, position);

  res.status(201).json(db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid));
});

// Toggle a goal done/not-done.
app.patch('/api/goals/:id', (req, res) => {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  if (!goal) return res.status(404).json({ error: 'not found' });

  const done = req.body.done !== undefined ? (req.body.done ? 1 : 0) : goal.done;
  db.prepare('UPDATE goals SET done = ? WHERE id = ?').run(done, goal.id);
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(goal.id));
});

app.delete('/api/goals/:id', (req, res) => {
  db.prepare('DELETE FROM goals WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// Add a task to a day.
app.get('/api/task-categories', (req, res) => {
  res.json(TASK_CATEGORIES);
});

app.post('/api/days/:dayId/tasks', (req, res) => {
  const dayId = Number(req.params.dayId);
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(dayId);
  if (!day) return res.status(404).json({ error: 'day not found' });

  const description = (req.body.description || '').trim();
  if (!description) return res.status(400).json({ error: 'description is required' });

  const category = (req.body.category || '').trim() || null;
  if (category && !TASK_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'invalid category' });
  }

  const info = db
    .prepare(
      "INSERT INTO tasks (day_id, description, category, start_time, status) VALUES (?, ?, ?, ?, 'open')"
    )
    .run(dayId, description, category, new Date().toISOString());

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...task, subtasks: [] });
});

// Append a subtask to a task's list (one at a time).
app.post('/api/tasks/:id/subtasks', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });

  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  const maxPosition = db
    .prepare('SELECT MAX(position) as maxPos FROM subtasks WHERE task_id = ?')
    .get(task.id).maxPos;

  const info = db
    .prepare('INSERT INTO subtasks (task_id, text, position, created_at) VALUES (?, ?, ?, ?)')
    .run(task.id, text, (maxPosition || 0) + 1, new Date().toISOString());

  res.status(201).json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(info.lastInsertRowid));
});

// Mark a task done: records end_time and computes duration.
app.patch('/api/tasks/:id/complete', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (task.status === 'done') return res.json(task);

  const end = new Date();
  const start = new Date(task.start_time);
  const duration = Math.max(0, Math.round((end - start) / 1000));

  db.prepare("UPDATE tasks SET end_time = ?, duration_seconds = ?, status = 'done' WHERE id = ?").run(
    end.toISOString(),
    duration,
    task.id
  );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

// Cancel a calendar-imported meeting task — used when the underlying meeting
// itself was cancelled. Unlike delete, the row (and its calendar_uid) is kept
// so a later sync never recreates it. Excluded from hour totals/stats.
app.patch('/api/tasks/:id/cancel', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (!task.calendar_uid) {
    return res.status(400).json({ error: 'only calendar-imported meetings can be cancelled' });
  }
  db.prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ?").run(task.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

// Edit a task's start/end time directly (corrections after the fact).
// Setting end_time marks the task done and recomputes duration; clearing it reopens the task.
app.patch('/api/tasks/:id/times', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });

  const start = new Date(req.body.start_time);
  if (Number.isNaN(start.getTime())) return res.status(400).json({ error: 'invalid start_time' });

  let end = null;
  let duration = null;
  let status = 'open';

  if (req.body.end_time) {
    end = new Date(req.body.end_time);
    if (Number.isNaN(end.getTime())) return res.status(400).json({ error: 'invalid end_time' });
    if (end < start) return res.status(400).json({ error: 'end_time must not be before start_time' });
    duration = Math.round((end - start) / 1000);
    status = 'done';
  }

  db.prepare('UPDATE tasks SET start_time = ?, end_time = ?, duration_seconds = ?, status = ? WHERE id = ?').run(
    start.toISOString(),
    end ? end.toISOString() : null,
    duration,
    status,
    task.id
  );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

// Edit a task's description/category.
app.patch('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });

  const description =
    req.body.description !== undefined ? req.body.description.trim() : task.description;
  const category =
    req.body.category !== undefined ? (req.body.category ? req.body.category.trim() || null : null) : task.category;

  if (category && !TASK_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'invalid category' });
  }

  db.prepare('UPDATE tasks SET description = ?, category = ? WHERE id = ?').run(
    description,
    category,
    task.id
  );
  res.json({ ...db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id), subtasks: subtasksForTask(task.id) });
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  if (task.status === 'done') return res.status(400).json({ error: 'a completed task cannot be deleted' });
  if (task.status === 'cancelled') {
    return res.status(400).json({ error: 'a cancelled meeting cannot be deleted (it would just resync)' });
  }

  db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// All sprints, each with its days and tasks, for the sprint-by-sprint view.
app.get('/api/sprints', (req, res) => {
  closeStaleOpenTasks();
  const sprints = db.prepare('SELECT * FROM sprints ORDER BY start_date DESC').all();

  const result = sprints.map((sprint) => {
    const days = db.prepare('SELECT * FROM days WHERE sprint_id = ? ORDER BY date').all(sprint.id);
    const daysWithTasks = days.map((day) => {
      const tasks = tasksForDay(day.id);
      return { ...day, tasks, totalSeconds: totalSeconds(tasks) };
    });
    const sprintTotal = daysWithTasks.reduce((sum, d) => sum + d.totalSeconds, 0);
    return { ...sprint, days: daysWithTasks, totalSeconds: sprintTotal };
  });

  res.json(result);
});

// Set or clear the optional, user-assigned sprint number for a period.
app.patch('/api/sprints/:id', (req, res) => {
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id);
  if (!sprint) return res.status(404).json({ error: 'not found' });

  const raw = req.body.sprint_number;
  let sprintNumber = null;
  if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
    sprintNumber = Number(raw);
    if (!Number.isInteger(sprintNumber)) {
      return res.status(400).json({ error: 'sprint_number must be a whole number' });
    }
  }

  try {
    db.prepare('UPDATE sprints SET sprint_number = ? WHERE id = ?').run(sprintNumber, sprint.id);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'that sprint number is already used by another period' });
    }
    throw err;
  }

  res.json(db.prepare('SELECT * FROM sprints WHERE id = ?').get(sprint.id));
});

function enumerateDateKeys(startKey, endKey) {
  const keys = [];
  let cursor = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  while (cursor <= end) {
    keys.push(toDateKey(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return keys;
}

// Hours worked over an arbitrary date range, plus a per-category breakdown, for the Statistics view.
app.get('/api/stats', (req, res) => {
  const start = req.query.start;
  const end = req.query.end;
  if (!start || !end) return res.status(400).json({ error: 'start and end query params are required' });
  if (start > end) return res.status(400).json({ error: 'start must not be after end' });

  const rows = db
    .prepare(
      `SELECT d.date as date, COALESCE(SUM(CASE WHEN t.status = 'cancelled' THEN 0 ELSE t.duration_seconds END), 0) as totalSeconds
       FROM days d LEFT JOIN tasks t ON t.day_id = d.id
       WHERE d.date BETWEEN ? AND ?
       GROUP BY d.date`
    )
    .all(start, end);
  const totalsByDate = new Map(rows.map((r) => [r.date, r.totalSeconds]));

  const days = enumerateDateKeys(start, end).map((date) => ({
    date,
    totalSeconds: totalsByDate.get(date) || 0,
  }));

  const totalSecondsSum = days.reduce((sum, d) => sum + d.totalSeconds, 0);
  const workedDays = days.filter((d) => d.totalSeconds > 0);

  const categoryRows = db
    .prepare(
      `SELECT COALESCE(t.category, 'Uncategorized') as category, SUM(t.duration_seconds) as totalSeconds
       FROM days d JOIN tasks t ON t.day_id = d.id
       WHERE d.date BETWEEN ? AND ? AND t.duration_seconds IS NOT NULL AND t.status != 'cancelled'
       GROUP BY category
       ORDER BY totalSeconds DESC`
    )
    .all(start, end);

  res.json({
    start,
    end,
    days,
    totalSeconds: totalSecondsSum,
    workedDayCount: workedDays.length,
    categories: categoryRows,
  });
});

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function formatHM(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

// CSV report for one or more sprints (by id), covering every day and task in them.
app.get('/api/sprints/export', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  if (ids.length === 0) return res.status(400).json({ error: 'ids query param is required' });

  const placeholders = ids.map(() => '?').join(',');
  const sprints = db.prepare(`SELECT * FROM sprints WHERE id IN (${placeholders}) ORDER BY start_date`).all(...ids);

  const rows = [
    ['Sprint #', 'Sprint Start', 'Sprint End', 'Date', 'Task', 'Category', 'Subtasks', 'Start Time', 'End Time', 'Duration (h:mm)', 'Status'],
  ];

  for (const sprint of sprints) {
    const days = db.prepare('SELECT * FROM days WHERE sprint_id = ? ORDER BY date').all(sprint.id);
    for (const day of days) {
      const tasks = tasksForDay(day.id);
      if (tasks.length === 0) {
        rows.push([sprint.sprint_number || '', sprint.start_date, sprint.end_date, day.date, '', '', '', '', '', '', '']);
        continue;
      }
      for (const task of tasks) {
        rows.push([
          sprint.sprint_number || '',
          sprint.start_date,
          sprint.end_date,
          day.date,
          task.description,
          task.category || '',
          task.subtasks.map((s) => s.text).join('; '),
          task.start_time,
          task.end_time || '',
          formatHM(task.duration_seconds),
          task.status,
        ]);
      }
    }
  }

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sprints-${ids.join('-')}.csv"`);
  res.send(csv);
});

// ---------- Reference links ----------

app.get('/api/references', (req, res) => {
  res.json(db.prepare('SELECT * FROM reference_links ORDER BY date DESC, id DESC').all());
});

app.post('/api/references', (req, res) => {
  const date = req.body.date;
  const url = String(req.body.url || '').trim();
  const title = String(req.body.title || '').trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'invalid date' });
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Enter a full link, starting with https://' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http:// and https:// links are supported' });
  }

  const info = db
    .prepare('INSERT INTO reference_links (date, title, url, created_at) VALUES (?, ?, ?, ?)')
    .run(date, title, parsed.href, new Date().toISOString());
  res.status(201).json(db.prepare('SELECT * FROM reference_links WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/references/:id', (req, res) => {
  db.prepare('DELETE FROM reference_links WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Monthly notes ----------

app.get('/api/note-categories', (req, res) => {
  res.json(NOTE_CATEGORIES);
});

// Note counts per month, newest first: [{ month: 'YYYY-MM', count }].
app.get('/api/notes/months', (req, res) => {
  const rows = db
    .prepare("SELECT substr(date, 1, 7) AS month, COUNT(*) AS count FROM notes GROUP BY month ORDER BY month DESC")
    .all();
  res.json(rows);
});

app.get('/api/notes', (req, res) => {
  const month = req.query.month;
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    return res.status(400).json({ error: 'month query param is required (YYYY-MM)' });
  }
  const notes = db
    .prepare("SELECT * FROM notes WHERE date LIKE ? ORDER BY date, id")
    .all(`${month}-%`);
  res.json(notes);
});

app.post('/api/notes', (req, res) => {
  const date = req.body.date;
  const category = req.body.category;
  const text = (req.body.text || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'invalid date' });
  if (!NOTE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'invalid category' });
  if (!text) return res.status(400).json({ error: 'text is required' });

  const info = db
    .prepare('INSERT INTO notes (date, category, text, created_at) VALUES (?, ?, ?, ?)')
    .run(date, category, text, new Date().toISOString());

  res.status(201).json(db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/notes/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'not found' });

  const date = req.body.date !== undefined ? req.body.date : note.date;
  const category = req.body.category !== undefined ? req.body.category : note.category;
  const text = req.body.text !== undefined ? req.body.text.trim() : note.text;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'invalid date' });
  if (!NOTE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'invalid category' });
  if (!text) return res.status(400).json({ error: 'text is required' });

  db.prepare('UPDATE notes SET date = ?, category = ?, text = ? WHERE id = ?').run(
    date,
    category,
    text,
    note.id
  );
  res.json(db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id));
});

app.delete('/api/notes/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Google Calendar integration ----------
//
// The ICS feed URL (a private "secret address in iCal format" from Google
// Calendar settings) is stored in the database and managed via the
// Integrations tab, and pulled on a timer so the client never waits on
// Google — it just reads whatever was cached last.

const CALENDAR_URL_SETTING_KEY = 'google_calendar_ics_url';
const CALENDAR_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
let calendarCache = { data: null, fetchedAt: null, error: null };

function getCalendarIcsUrl() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CALENDAR_URL_SETTING_KEY);
  return row ? row.value : null;
}

function setCalendarIcsUrl(icsUrl) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    CALENDAR_URL_SETTING_KEY,
    icsUrl
  );
}

function clearCalendarIcsUrl() {
  db.prepare('DELETE FROM settings WHERE key = ?').run(CALENDAR_URL_SETTING_KEY);
}

async function refreshCalendarCache() {
  const icsUrl = getCalendarIcsUrl();
  if (!icsUrl) {
    calendarCache = { data: null, fetchedAt: null, error: 'No calendar linked yet — add one in the Integrations tab' };
    return;
  }
  try {
    const data = await ical.async.fromURL(icsUrl);
    calendarCache = { data, fetchedAt: new Date().toISOString(), error: null };
  } catch (err) {
    calendarCache = { ...calendarCache, error: err.message || 'Failed to fetch calendar' };
  }
}

function calendarEventsForDate(dateKey) {
  if (!calendarCache.data) return [];

  const dayStart = parseDateKey(dateKey);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const events = [];

  for (const key of Object.keys(calendarCache.data)) {
    const item = calendarCache.data[key];
    if (item.type !== 'VEVENT') continue;
    if (item.status && String(item.status).toUpperCase() === 'CANCELLED') continue;

    if (item.rrule) {
      // Recurring event: expand just the occurrences that fall on this day.
      // Each occurrence gets its own stable id (series uid + its own start time).
      const durationMs = new Date(item.end).getTime() - new Date(item.start).getTime();
      const occurrences = item.rrule.between(dayStart, dayEnd, true);
      occurrences.forEach((occStart) => {
        events.push({
          uid: `${item.uid}::${occStart.toISOString()}`,
          title: item.summary || '(no title)',
          start: occStart.toISOString(),
          end: new Date(occStart.getTime() + durationMs).toISOString(),
          allDay: item.datetype === 'date',
        });
      });
    } else {
      const start = new Date(item.start);
      const end = new Date(item.end || item.start);
      if (start < dayEnd && end > dayStart) {
        events.push({
          uid: item.uid,
          title: item.summary || '(no title)',
          start: start.toISOString(),
          end: end.toISOString(),
          allDay: item.datetype === 'date',
        });
      }
    }
  }

  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return events;
}

// Creates a 'Meetings' task for each timed calendar event that doesn't already
// have one on this day (matched by calendar_uid), so meetings count toward the
// day's logged hours automatically. All-day events (holidays, reminders) are
// skipped — they aren't real time spent.
//
// A meeting is only marked done once its scheduled end time has actually
// passed — one that hasn't started yet, or is still in progress, is inserted
// as open, and gets auto-completed on a later sync once its end time passes
// (unless the user already marked it done manually, which is left alone).
function importCalendarEventsAsTasks(dateKey, events) {
  const timedEvents = events.filter((ev) => !ev.allDay);
  if (timedEvents.length === 0) return;

  const day = getOrCreateDay(dateKey);
  const existingByUid = new Map(
    db
      .prepare('SELECT id, status, calendar_uid FROM tasks WHERE day_id = ? AND calendar_uid IS NOT NULL')
      .all(day.id)
      .map((r) => [r.calendar_uid, r])
  );

  const insert = db.prepare(
    `INSERT INTO tasks (day_id, description, category, calendar_uid, start_time, end_time, duration_seconds, status)
     VALUES (?, ?, 'Meetings', ?, ?, ?, ?, ?)`
  );
  const markDone = db.prepare("UPDATE tasks SET end_time = ?, duration_seconds = ?, status = 'done' WHERE id = ?");

  const now = new Date();

  for (const ev of timedEvents) {
    const end = new Date(ev.end);
    const hasEnded = now >= end;
    const durationSeconds = Math.max(0, Math.round((end - new Date(ev.start)) / 1000));
    const existing = existingByUid.get(ev.uid);

    if (existing) {
      if (existing.status === 'open' && hasEnded) {
        markDone.run(ev.end, durationSeconds, existing.id);
      }
      continue;
    }

    if (hasEnded) {
      insert.run(day.id, ev.title, ev.uid, ev.start, ev.end, durationSeconds, 'done');
    } else {
      insert.run(day.id, ev.title, ev.uid, ev.start, null, null, 'open');
    }
  }
}

// Integrations tab: view/set/clear the linked calendar's ICS URL.
app.get('/api/integrations/calendar', (req, res) => {
  res.json({
    icsUrl: getCalendarIcsUrl(),
    fetchedAt: calendarCache.fetchedAt,
    error: calendarCache.error,
  });
});

app.put('/api/integrations/calendar', async (req, res) => {
  const icsUrl = (req.body.icsUrl || '').trim();
  if (!/^https?:\/\/.+/.test(icsUrl)) {
    return res.status(400).json({ error: 'Enter a valid http(s) calendar URL' });
  }

  setCalendarIcsUrl(icsUrl);
  await refreshCalendarCache();
  res.json({ icsUrl, fetchedAt: calendarCache.fetchedAt, error: calendarCache.error });
});

app.delete('/api/integrations/calendar', (req, res) => {
  clearCalendarIcsUrl();
  calendarCache = { data: null, fetchedAt: null, error: 'No calendar linked yet — add one in the Integrations tab' };
  res.status(204).end();
});

app.get('/api/calendar/day', (req, res) => {
  const dateKey = req.query.date || toDateKey(new Date());
  if (calendarCache.error && !calendarCache.data) {
    return res.status(502).json({ error: calendarCache.error });
  }
  const events = calendarEventsForDate(dateKey);
  importCalendarEventsAsTasks(dateKey, events);
  res.json({ date: dateKey, events, fetchedAt: calendarCache.fetchedAt });
});

// On-demand refresh, for a manual "refresh now" affordance in the UI.
app.post('/api/calendar/refresh', async (req, res) => {
  await refreshCalendarCache();
  const dateKey = req.query.date || toDateKey(new Date());
  if (calendarCache.error && !calendarCache.data) {
    return res.status(502).json({ error: calendarCache.error });
  }
  const events = calendarEventsForDate(dateKey);
  importCalendarEventsAsTasks(dateKey, events);
  res.json({ date: dateKey, events, fetchedAt: calendarCache.fetchedAt });
});

refreshCalendarCache();
setInterval(refreshCalendarCache, CALENDAR_REFRESH_INTERVAL_MS);

const STALE_TASK_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
closeStaleOpenTasks();
setInterval(closeStaleOpenTasks, STALE_TASK_SWEEP_INTERVAL_MS);

// ---------- Objectives (longer-running goals, tracked over many days) ----------

app.get('/api/objective-statuses', (req, res) => {
  res.json(OBJECTIVE_STATUSES);
});

app.get('/api/objective-priorities', (req, res) => {
  res.json(OBJECTIVE_PRIORITIES);
});

function objectiveUpdates(objectiveId) {
  return db
    .prepare('SELECT * FROM objective_updates WHERE objective_id = ? ORDER BY date DESC, id DESC')
    .all(objectiveId);
}
function objectiveSubtasks(objectiveId) {
  return db
    .prepare('SELECT * FROM objective_subtasks WHERE objective_id = ? ORDER BY due_date, id')
    .all(objectiveId);
}

app.get('/api/objectives', (req, res) => {
  const objectives = db
    .prepare(
      `SELECT * FROM objectives
       ORDER BY
         CASE status WHEN 'In Progress' THEN 0 WHEN 'To Do' THEN 1 ELSE 2 END,
         CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 WHEN 'Low' THEN 2 ELSE 3 END,
         id DESC`
    )
    .all();
  const result = objectives.map((o) => ({
    ...o,
    updates: objectiveUpdates(o.id),
    decisions: objectiveItems(OBJECTIVE_ITEM_KINDS[0], o.id),
    questions: objectiveItems(OBJECTIVE_ITEM_KINDS[1], o.id),
    subtasks: objectiveSubtasks(o.id),
  }));
  res.json(result);
});

// Creates an objective, optionally with its first update, decisions, questions
// and TO-DOs, all in one transaction so a bad field never leaves a half-made objective.
app.post('/api/objectives', (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title is required' });

  const priority = req.body.priority !== undefined ? req.body.priority : 'Medium';
  if (!OBJECTIVE_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'invalid priority' });
  const status = req.body.status !== undefined ? req.body.status : 'To Do';
  if (!OBJECTIVE_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });

  const texts = (list) =>
    (Array.isArray(list) ? list : []).map((t) => String(t || '').trim()).filter(Boolean);
  const decisions = texts(req.body.decisions);
  const questions = texts(req.body.questions);

  const update = req.body.update ? String(req.body.update.text || '').trim() : '';
  const updateDate = req.body.update ? req.body.update.date : null;
  if (update && !/^\d{4}-\d{2}-\d{2}$/.test(updateDate || '')) {
    return res.status(400).json({ error: 'invalid update date' });
  }

  const subtasks = (Array.isArray(req.body.subtasks) ? req.body.subtasks : [])
    .map((s) => ({ text: String((s && s.text) || '').trim(), due_date: s && s.due_date }))
    .filter((s) => s.text);
  if (subtasks.some((s) => !/^\d{4}-\d{2}-\d{2}$/.test(s.due_date || ''))) {
    return res.status(400).json({ error: 'every TO-DO needs a due date' });
  }

  const now = new Date().toISOString();
  const objectiveId = db.transaction(() => {
    const id = db
      .prepare('INSERT INTO objectives (title, status, priority, created_at) VALUES (?, ?, ?, ?)')
      .run(title, status, priority, now).lastInsertRowid;
    if (update) {
      db.prepare('INSERT INTO objective_updates (objective_id, date, text, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        updateDate,
        update,
        now
      );
    }
    const insertItem = (table, text) =>
      db.prepare(`INSERT INTO ${table} (objective_id, text, resolved, created_at) VALUES (?, ?, 0, ?)`).run(id, text, now);
    decisions.forEach((t) => insertItem('objective_decisions', t));
    questions.forEach((t) => insertItem('objective_questions', t));
    subtasks.forEach((s) =>
      db
        .prepare('INSERT INTO objective_subtasks (objective_id, text, due_date, done, created_at) VALUES (?, ?, ?, 0, ?)')
        .run(id, s.text, s.due_date, now)
    );
    return id;
  })();

  res.status(201).json({
    ...db.prepare('SELECT * FROM objectives WHERE id = ?').get(objectiveId),
    updates: objectiveUpdates(objectiveId),
    decisions: objectiveItems(OBJECTIVE_ITEM_KINDS[0], objectiveId),
    questions: objectiveItems(OBJECTIVE_ITEM_KINDS[1], objectiveId),
    subtasks: objectiveSubtasks(objectiveId),
  });
});

app.patch('/api/objectives/:id', (req, res) => {
  const objective = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
  if (!objective) return res.status(404).json({ error: 'not found' });

  const title = req.body.title !== undefined ? req.body.title.trim() : objective.title;
  const status = req.body.status !== undefined ? req.body.status : objective.status;
  const priority = req.body.priority !== undefined ? req.body.priority : objective.priority;
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!OBJECTIVE_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
  if (!OBJECTIVE_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'invalid priority' });

  db.prepare('UPDATE objectives SET title = ?, status = ?, priority = ? WHERE id = ?').run(
    title,
    status,
    priority,
    objective.id
  );
  res.json(db.prepare('SELECT * FROM objectives WHERE id = ?').get(objective.id));
});

app.delete('/api/objectives/:id', (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM objective_updates WHERE objective_id = ?').run(id);
  deleteObjectiveItems(id);
  db.prepare('DELETE FROM objective_subtasks WHERE objective_id = ?').run(id);
  db.prepare('DELETE FROM objectives WHERE id = ?').run(id);
  res.status(204).end();
});

// Progress updates — one per day, dated.
app.post('/api/objectives/:id/updates', (req, res) => {
  const objective = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
  if (!objective) return res.status(404).json({ error: 'not found' });

  const date = req.body.date;
  const text = (req.body.text || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'invalid date' });
  if (!text) return res.status(400).json({ error: 'text is required' });

  const info = db
    .prepare('INSERT INTO objective_updates (objective_id, date, text, created_at) VALUES (?, ?, ?, ?)')
    .run(objective.id, date, text, new Date().toISOString());

  res.status(201).json(db.prepare('SELECT * FROM objective_updates WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/objective-updates/:id', (req, res) => {
  db.prepare('DELETE FROM objective_updates WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// Decisions and questions: both are a resolvable item on an objective with a
// checklist of next steps, so they share one set of routes.
const OBJECTIVE_ITEM_KINDS = [
  {
    collection: 'decisions', // POST /api/objectives/:id/decisions
    route: 'objective-decisions',
    table: 'objective_decisions',
    stepsRoute: 'decision-next-steps',
    stepsTable: 'decision_next_steps',
    stepsFk: 'decision_id',
  },
  {
    collection: 'questions',
    route: 'objective-questions',
    table: 'objective_questions',
    stepsRoute: 'question-next-steps',
    stepsTable: 'question_next_steps',
    stepsFk: 'question_id',
  },
];

function objectiveItems(kind, objectiveId) {
  return db
    .prepare(`SELECT * FROM ${kind.table} WHERE objective_id = ? ORDER BY id`)
    .all(objectiveId)
    .map((item) => ({
      ...item,
      next_steps: db.prepare(`SELECT * FROM ${kind.stepsTable} WHERE ${kind.stepsFk} = ? ORDER BY id`).all(item.id),
    }));
}

function deleteObjectiveItems(objectiveId) {
  OBJECTIVE_ITEM_KINDS.forEach((kind) => {
    db.prepare(
      `DELETE FROM ${kind.stepsTable} WHERE ${kind.stepsFk} IN (SELECT id FROM ${kind.table} WHERE objective_id = ?)`
    ).run(objectiveId);
    db.prepare(`DELETE FROM ${kind.table} WHERE objective_id = ?`).run(objectiveId);
  });
}

OBJECTIVE_ITEM_KINDS.forEach((kind) => {
  app.post(`/api/objectives/:id/${kind.collection}`, (req, res) => {
    const objective = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
    if (!objective) return res.status(404).json({ error: 'not found' });

    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });

    const info = db
      .prepare(`INSERT INTO ${kind.table} (objective_id, text, resolved, created_at) VALUES (?, ?, 0, ?)`)
      .run(objective.id, text, new Date().toISOString());

    res.status(201).json(db.prepare(`SELECT * FROM ${kind.table} WHERE id = ?`).get(info.lastInsertRowid));
  });

  app.patch(`/api/${kind.route}/:id`, (req, res) => {
    const item = db.prepare(`SELECT * FROM ${kind.table} WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });

    const resolved = req.body.resolved !== undefined ? (req.body.resolved ? 1 : 0) : item.resolved;
    db.prepare(`UPDATE ${kind.table} SET resolved = ? WHERE id = ?`).run(resolved, item.id);
    res.json(db.prepare(`SELECT * FROM ${kind.table} WHERE id = ?`).get(item.id));
  });

  app.delete(`/api/${kind.route}/:id`, (req, res) => {
    db.prepare(`DELETE FROM ${kind.stepsTable} WHERE ${kind.stepsFk} = ?`).run(req.params.id);
    db.prepare(`DELETE FROM ${kind.table} WHERE id = ?`).run(req.params.id);
    res.status(204).end();
  });

  // Next steps that follow on from a decision / question.
  app.post(`/api/${kind.route}/:id/next-steps`, (req, res) => {
    const item = db.prepare(`SELECT * FROM ${kind.table} WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });

    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });

    const info = db
      .prepare(`INSERT INTO ${kind.stepsTable} (${kind.stepsFk}, text, done, created_at) VALUES (?, ?, 0, ?)`)
      .run(item.id, text, new Date().toISOString());

    res.status(201).json(db.prepare(`SELECT * FROM ${kind.stepsTable} WHERE id = ?`).get(info.lastInsertRowid));
  });

  app.patch(`/api/${kind.stepsRoute}/:id`, (req, res) => {
    const step = db.prepare(`SELECT * FROM ${kind.stepsTable} WHERE id = ?`).get(req.params.id);
    if (!step) return res.status(404).json({ error: 'not found' });

    const text = req.body.text !== undefined ? String(req.body.text).trim() : step.text;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const done = req.body.done !== undefined ? (req.body.done ? 1 : 0) : step.done;

    db.prepare(`UPDATE ${kind.stepsTable} SET text = ?, done = ? WHERE id = ?`).run(text, done, step.id);
    res.json(db.prepare(`SELECT * FROM ${kind.stepsTable} WHERE id = ?`).get(step.id));
  });

  app.delete(`/api/${kind.stepsRoute}/:id`, (req, res) => {
    db.prepare(`DELETE FROM ${kind.stepsTable} WHERE id = ?`).run(req.params.id);
    res.status(204).end();
  });
});

// Sub-tasks with a "complete by" due date.
app.post('/api/objectives/:id/subtasks', (req, res) => {
  const objective = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
  if (!objective) return res.status(404).json({ error: 'not found' });

  const text = (req.body.text || '').trim();
  const dueDate = req.body.due_date;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')) return res.status(400).json({ error: 'invalid due_date' });

  const info = db
    .prepare('INSERT INTO objective_subtasks (objective_id, text, due_date, done, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(objective.id, text, dueDate, new Date().toISOString());

  res.status(201).json(db.prepare('SELECT * FROM objective_subtasks WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/objective-subtasks/:id', (req, res) => {
  const subtask = db.prepare('SELECT * FROM objective_subtasks WHERE id = ?').get(req.params.id);
  if (!subtask) return res.status(404).json({ error: 'not found' });

  const done = req.body.done !== undefined ? (req.body.done ? 1 : 0) : subtask.done;

  let dueDate = subtask.due_date;
  if (req.body.due_date !== undefined) {
    dueDate = req.body.due_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')) return res.status(400).json({ error: 'invalid due_date' });
  }

  db.prepare('UPDATE objective_subtasks SET done = ?, due_date = ? WHERE id = ?').run(done, dueDate, subtask.id);
  res.json(db.prepare('SELECT * FROM objective_subtasks WHERE id = ?').get(subtask.id));
});

app.delete('/api/objective-subtasks/:id', (req, res) => {
  db.prepare('DELETE FROM objective_subtasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`sprint-tracker running at http://localhost:${PORT}`);
});
