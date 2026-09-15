const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'sprint-tracker.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sprint_number INTEGER UNIQUE,
    start_date TEXT UNIQUE NOT NULL,
    end_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sprint_id INTEGER NOT NULL REFERENCES sprints(id),
    date TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id INTEGER NOT NULL REFERENCES days(id),
    description TEXT NOT NULL,
    comment TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_seconds INTEGER,
    status TEXT NOT NULL DEFAULT 'open'
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id INTEGER NOT NULL REFERENCES days(id),
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    text TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Migration: sprints used to be identified/looked-up by an auto-numbered
// sprint_number (NOT NULL UNIQUE). Periods are now identified by start_date,
// and sprint_number is an optional user-assigned label — recreate the table
// with the new constraints, carrying over any numbers already assigned.
const sprintNumberCol = db.prepare('PRAGMA table_info(sprints)').all().find((c) => c.name === 'sprint_number');
if (sprintNumberCol && sprintNumberCol.notnull === 1) {
  // days.sprint_id references sprints(id) — foreign key checks must be off
  // while the table is dropped and recreated under the same name.
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE sprints_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sprint_number INTEGER UNIQUE,
      start_date TEXT UNIQUE NOT NULL,
      end_date TEXT NOT NULL
    );
    INSERT INTO sprints_new (id, sprint_number, start_date, end_date)
      SELECT id, sprint_number, start_date, end_date FROM sprints;
    DROP TABLE sprints;
    ALTER TABLE sprints_new RENAME TO sprints;
  `);
  db.pragma('foreign_keys = ON');
}

// Migrations: columns added to tasks after the initial release.
const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
if (!taskColumns.includes('category')) {
  db.exec('ALTER TABLE tasks ADD COLUMN category TEXT');
}
if (!taskColumns.includes('calendar_uid')) {
  db.exec('ALTER TABLE tasks ADD COLUMN calendar_uid TEXT');
}

// Migration: free-text task comments are replaced by an ordered list of
// subtasks. Carry over any existing comment as that task's first subtask,
// then drop the now-unused column.
if (taskColumns.includes('comment')) {
  const tasksWithComments = db
    .prepare("SELECT id, comment FROM tasks WHERE comment IS NOT NULL AND TRIM(comment) != ''")
    .all();
  const insertSubtask = db.prepare(
    'INSERT INTO subtasks (task_id, text, position, created_at) VALUES (?, ?, 1, ?)'
  );
  const now = new Date().toISOString();
  for (const t of tasksWithComments) {
    insertSubtask.run(t.id, t.comment.trim(), now);
  }
  db.exec('ALTER TABLE tasks DROP COLUMN comment');
}

// One-time seed: carry over an existing GOOGLE_CALENDAR_ICS_URL from .env into the
// database so it shows up as already-linked in the Integrations tab. The database
// is the source of truth from here on — the Integrations UI updates it directly.
const hasCalendarSetting = db.prepare("SELECT 1 FROM settings WHERE key = 'google_calendar_ics_url'").get();
if (!hasCalendarSetting && process.env.GOOGLE_CALENDAR_ICS_URL) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'google_calendar_ics_url',
    process.env.GOOGLE_CALENDAR_ICS_URL
  );
}

module.exports = db;
