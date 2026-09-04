const path = require('path');
const express = require('express');
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
];

const NOTE_CATEGORIES = ['Challenges', 'Achievements', 'Mistakes', 'Learnings'];

const app = express();
const PORT = process.env.PORT || 4100;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getOrCreateSprint(dateKey) {
  const { sprintNumber, startDate, endDate } = computeSprintForDate(dateKey);
  let sprint = db.prepare('SELECT * FROM sprints WHERE sprint_number = ?').get(sprintNumber);
  if (!sprint) {
    const info = db
      .prepare('INSERT INTO sprints (sprint_number, start_date, end_date) VALUES (?, ?, ?)')
      .run(sprintNumber, startDate, endDate);
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

function tasksForDay(dayId) {
  return db.prepare('SELECT * FROM tasks WHERE day_id = ? ORDER BY id').all(dayId);
}

function totalSeconds(tasks) {
  return tasks.reduce((sum, t) => sum + (t.duration_seconds || 0), 0);
}

function goalsForDay(dayId) {
  return db.prepare('SELECT * FROM goals WHERE day_id = ? ORDER BY position').all(dayId);
}

const MAX_GOALS_PER_DAY = 3;

// GET a day (creating it + its sprint on first access), with its tasks and goals.
app.get('/api/day', (req, res) => {
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
  const comment = (req.body.comment || '').trim() || null;

  const category = (req.body.category || '').trim() || null;
  if (category && !TASK_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'invalid category' });
  }

  const info = db
    .prepare(
      "INSERT INTO tasks (day_id, description, comment, category, start_time, status) VALUES (?, ?, ?, ?, ?, 'open')"
    )
    .run(dayId, description, comment, category, new Date().toISOString());

  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
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

// Edit a task's description/comment/category.
app.patch('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });

  const description =
    req.body.description !== undefined ? req.body.description.trim() : task.description;
  const comment =
    req.body.comment !== undefined ? req.body.comment.trim() || null : task.comment;
  const category =
    req.body.category !== undefined ? req.body.category.trim() || null : task.category;

  if (category && !TASK_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'invalid category' });
  }

  db.prepare('UPDATE tasks SET description = ?, comment = ?, category = ? WHERE id = ?').run(
    description,
    comment,
    category,
    task.id
  );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// All sprints, each with its days and tasks, for the sprint-by-sprint view.
app.get('/api/sprints', (req, res) => {
  const sprints = db.prepare('SELECT * FROM sprints ORDER BY sprint_number DESC').all();

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
      `SELECT d.date as date, COALESCE(SUM(t.duration_seconds), 0) as totalSeconds
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
       WHERE d.date BETWEEN ? AND ? AND t.duration_seconds IS NOT NULL
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

// CSV report for one or more sprints (by sprint_number), covering every day and task in them.
app.get('/api/sprints/export', (req, res) => {
  const numbers = String(req.query.numbers || '')
    .split(',')
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  if (numbers.length === 0) return res.status(400).json({ error: 'numbers query param is required' });

  const placeholders = numbers.map(() => '?').join(',');
  const sprints = db
    .prepare(`SELECT * FROM sprints WHERE sprint_number IN (${placeholders}) ORDER BY sprint_number`)
    .all(...numbers);

  const rows = [
    ['Sprint', 'Sprint Start', 'Sprint End', 'Date', 'Task', 'Category', 'Comment', 'Start Time', 'End Time', 'Duration (h:mm)', 'Status'],
  ];

  for (const sprint of sprints) {
    const days = db.prepare('SELECT * FROM days WHERE sprint_id = ? ORDER BY date').all(sprint.id);
    for (const day of days) {
      const tasks = tasksForDay(day.id);
      if (tasks.length === 0) {
        rows.push([sprint.sprint_number, sprint.start_date, sprint.end_date, day.date, '', '', '', '', '', '', '']);
        continue;
      }
      for (const task of tasks) {
        rows.push([
          sprint.sprint_number,
          sprint.start_date,
          sprint.end_date,
          day.date,
          task.description,
          task.category || '',
          task.comment || '',
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
  res.setHeader('Content-Disposition', `attachment; filename="sprints-${numbers.join('-')}.csv"`);
  res.send(csv);
});

// ---------- Monthly notes ----------

app.get('/api/note-categories', (req, res) => {
  res.json(NOTE_CATEGORIES);
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

app.listen(PORT, () => {
  console.log(`sprint-tracker running at http://localhost:${PORT}`);
});
