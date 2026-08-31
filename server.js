const path = require('path');
const express = require('express');
const db = require('./db');
const { toDateKey, computeSprintForDate } = require('./sprint-math');

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

// GET a day (creating it + its sprint on first access), with its tasks.
app.get('/api/day', (req, res) => {
  const dateKey = req.query.date || toDateKey(new Date());
  const day = getOrCreateDay(dateKey);
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(day.sprint_id);
  const tasks = tasksForDay(day.id);
  res.json({ day, sprint, tasks, totalSeconds: totalSeconds(tasks) });
});

// Add a task to a day.
app.post('/api/days/:dayId/tasks', (req, res) => {
  const dayId = Number(req.params.dayId);
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(dayId);
  if (!day) return res.status(404).json({ error: 'day not found' });

  const description = (req.body.description || '').trim();
  if (!description) return res.status(400).json({ error: 'description is required' });
  const comment = (req.body.comment || '').trim() || null;

  const info = db
    .prepare(
      "INSERT INTO tasks (day_id, description, comment, start_time, status) VALUES (?, ?, ?, ?, 'open')"
    )
    .run(dayId, description, comment, new Date().toISOString());

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

// Edit a task's description/comment.
app.patch('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });

  const description =
    req.body.description !== undefined ? req.body.description.trim() : task.description;
  const comment =
    req.body.comment !== undefined ? req.body.comment.trim() || null : task.comment;

  db.prepare('UPDATE tasks SET description = ?, comment = ? WHERE id = ?').run(
    description,
    comment,
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
    ['Sprint', 'Sprint Start', 'Sprint End', 'Date', 'Task', 'Comment', 'Start Time', 'End Time', 'Duration (h:mm)', 'Status'],
  ];

  for (const sprint of sprints) {
    const days = db.prepare('SELECT * FROM days WHERE sprint_id = ? ORDER BY date').all(sprint.id);
    for (const day of days) {
      const tasks = tasksForDay(day.id);
      if (tasks.length === 0) {
        rows.push([sprint.sprint_number, sprint.start_date, sprint.end_date, day.date, '', '', '', '', '', '']);
        continue;
      }
      for (const task of tasks) {
        rows.push([
          sprint.sprint_number,
          sprint.start_date,
          sprint.end_date,
          day.date,
          task.description,
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

app.listen(PORT, () => {
  console.log(`sprint-tracker running at http://localhost:${PORT}`);
});
