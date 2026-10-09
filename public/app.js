const state = {
  dateKey: todayKey(),
  selectedSprints: new Set(),
  taskCategories: [],
};

// Task ids whose ✎ edit form is currently open. Only used to gate adding
// sub-tasks to an already-completed task — open tasks can always add one.
const openTaskEditIds = new Set();

const CATEGORY_COLORS = {
  Research: '#1c7ed6',
  'Story writing': '#7048e8',
  Demo: '#f59f00',
  'Sanity testing': '#12b886',
  Presentations: '#e64980',
  Meetings: '#fa5252',
  Adhoc: '#82c91e',
  Support: '#15aabf',
  'Domain learning': '#ae3ec9',
  Documentation: '#495057',
  Uncategorized: '#868e96',
};

function categoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.Uncategorized;
}

// Keyword hints used to auto-suggest a category while typing a task
// description. Checked in this order — first match wins.
const CATEGORY_KEYWORDS = {
  Research: ['research', 'analysis', 'analyse', 'analyze', 'investigat', 'explor'],
  'Story writing': ['user story', 'user stories', 'story writing', 'writing the story', 'backlog item'],
  Demo: ['demo'],
  'Sanity testing': ['sanity test', 'sanity check', 'testing', 'qa ', 'bug fix', 'verify'],
  Presentations: ['presentation', 'slide', 'slides', 'deck'],
  Meetings: ['meeting', 'call with', 'sync up', 'standup', 'stand-up', 'huddle', '1:1', '1-1', 'catch up', 'catchup'],
  Adhoc: ['adhoc', 'ad-hoc', 'ad hoc'],
  Support: ['support', 'ticket', 'help desk'],
  'Domain learning': ['learn', 'domain learning', 'domain knowledge', 'kt session', 'knowledge transfer', 'onboarding'],
  Documentation: ['documentation', 'document', 'docs', 'readme', 'wiki'],
};

function guessCategoryFromText(text) {
  const lower = text.toLowerCase();
  for (const category of state.taskCategories) {
    const keywords = CATEGORY_KEYWORDS[category] || [];
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return null;
}

// ---------- Task categories ----------

const DEFAULT_TASK_CATEGORY = 'Adhoc';

async function loadTaskCategories() {
  const res = await fetch('/api/task-categories');
  state.taskCategories = await res.json();
  populateCategorySelect(document.getElementById('task-category'), DEFAULT_TASK_CATEGORY);
}

function categoryOptionsHtml(selected) {
  const options = ['<option value="">No category</option>'];
  state.taskCategories.forEach((c) => {
    const sel = c === selected ? ' selected' : '';
    options.push(`<option value="${escapeAttr(c)}"${sel}>${escapeAttr(c)}</option>`);
  });
  return options.join('');
}

function populateCategorySelect(selectEl, selected) {
  selectEl.innerHTML = categoryOptionsHtml(selected);
}

loadTaskCategories();

// ---------- Theme ----------

const THEME_KEY = 'sprint-tracker-theme';

function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function writeStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable (private browsing, blocked cookies, etc.) — theme just won't persist.
  }
}

function isDarkActive() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit) return explicit === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme) {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
  document.getElementById('theme-toggle').textContent = isDarkActive() ? '☀️' : '🌙';
}

applyTheme(readStoredTheme());

document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = isDarkActive() ? 'light' : 'dark';
  writeStoredTheme(next);
  applyTheme(next);
});

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return toDateKey(new Date());
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Phrases a sub-task's due_date relative to today, for reminder panels
// (so "complete by" reads naturally instead of a bare date in most cases).
function relativeDueLabel(dueDateStr) {
  const todayDate = new Date(todayKey() + 'T00:00:00');
  const dueDate = new Date(dueDateStr + 'T00:00:00');
  const diffDays = Math.round((dueDate - todayDate) / 86400000);

  if (diffDays < 0) return { text: `Overdue · ${formatDateLabel(dueDateStr)}`, variant: 'overdue' };
  if (diffDays === 0) return { text: 'Due today', variant: 'today' };
  if (diffDays === 1) return { text: 'Due tomorrow', variant: 'soon' };
  return { text: `Due ${formatDateLabel(dueDateStr)}`, variant: 'later' };
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Converts an ISO timestamp to the "HH:mm" format time inputs need.
function toLocalTimeInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Builds a Date using referenceIso's calendar day and an "HH:mm" time-of-day —
// tasks always start and end on the day they were created, so only the time is editable.
function combineDateAndTime(referenceIso, timeStr) {
  const ref = new Date(referenceIso);
  const [hours, minutes] = timeStr.split(':').map(Number);
  return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), hours, minutes);
}

// ---------- Tabs ----------

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'sprints') loadSprints();
    if (btn.dataset.tab === 'stats') initStats();
    if (btn.dataset.tab === 'notes') initNotesTab();
    if (btn.dataset.tab === 'objectives') initObjectives();
    if (btn.dataset.tab === 'decisions') loadDecisions();
    if (btn.dataset.tab === 'integrations') loadIntegrationStatus();
  });
});

// ---------- Confirm dialog ----------

const confirmOverlay = document.getElementById('confirm-overlay');

// Resolves true when the user clicks Delete, false on Cancel / Escape / backdrop click.
function confirmDialog(message) {
  return new Promise((resolve) => {
    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    document.getElementById('confirm-message').textContent = message;
    confirmOverlay.hidden = false;
    cancelBtn.focus();

    function close(result) {
      confirmOverlay.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      confirmOverlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    }
    function onOk() { close(true); }
    function onCancel() { close(false); }
    function onBackdrop(e) { if (e.target === confirmOverlay) close(false); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    confirmOverlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey, true);
  });
}

// ---------- Idle lock ----------

const IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const idleOverlay = document.getElementById('idle-overlay');
let idleTimer = null;

function resetIdleTimer() {
  if (!idleOverlay.hidden) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(showIdleOverlay, IDLE_TIMEOUT_MS);
}

function showIdleOverlay() {
  idleOverlay.hidden = false;
  document.getElementById('idle-resume-btn').focus();
}

document.getElementById('idle-resume-btn').addEventListener('click', () => {
  idleOverlay.hidden = true;
  state.dateKey = todayKey();
  datePicker.value = state.dateKey;
  document.getElementById('tab-today').click();
  loadDay();
  resetIdleTimer();
});

['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach((evt) => {
  document.addEventListener(evt, resetIdleTimer, { passive: true, capture: true });
});
resetIdleTimer();

// ---------- Today view ----------

const datePicker = document.getElementById('date-picker');
datePicker.value = state.dateKey;
datePicker.addEventListener('change', () => {
  state.dateKey = datePicker.value;
  loadDay();
});

async function loadDayData() {
  const res = await fetch(`/api/day?date=${state.dateKey}`);
  const data = await res.json();
  state.dayId = data.day.id;
  renderDay(data);
  return data;
}

async function loadDay() {
  const data = await loadDayData();
  loadCalendarEvents();
  return data;
}

// ---------- Objective deadlines reminder (shown on the Today page) ----------

// Pending objective sub-tasks due soon, independent of whichever date is
// selected on the day picker — this is a reminder of upcoming/overdue
// objective work, not tied to a particular day's tasks.
const OBJECTIVE_DEADLINE_HORIZON_DAYS = 7;

function computeUpcomingObjectiveDeadlines(objectives) {
  const todayDate = new Date(todayKey() + 'T00:00:00');
  const items = [];
  objectives
    .filter((o) => o.status !== 'Done')
    .forEach((o) => {
      o.subtasks.forEach((s) => {
        if (s.done) return;
        const dueDate = new Date(s.due_date + 'T00:00:00');
        const diffDays = Math.round((dueDate - todayDate) / 86400000);
        if (diffDays <= OBJECTIVE_DEADLINE_HORIZON_DAYS) {
          items.push({ subtask: s, objectiveTitle: o.title, diffDays });
        }
      });
    });
  items.sort((a, b) => a.diffDays - b.diffDays);
  return items;
}

function renderObjectiveDeadlinesPanel(objectives) {
  const container = document.getElementById('objective-deadlines-panel');
  container.innerHTML = '';

  const items = computeUpcomingObjectiveDeadlines(objectives);
  if (items.length === 0) return;

  const panel = document.createElement('div');
  panel.className = 'due-today-panel objective-deadlines-panel';

  const heading = document.createElement('h3');
  heading.textContent = `Objective deadlines (${items.length})`;
  panel.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'due-today-table';
  const tbody = document.createElement('tbody');

  items.forEach(({ subtask, objectiveTitle }) => {
    const row = document.createElement('tr');

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.addEventListener('change', async () => {
      await fetch(`/api/objective-subtasks/${subtask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: checkbox.checked }),
      });
      loadObjectiveDeadlines();
    });
    checkboxCell.appendChild(checkbox);
    row.appendChild(checkboxCell);

    const textCell = document.createElement('td');
    textCell.className = 'due-today-text';
    textCell.textContent = subtask.text;
    row.appendChild(textCell);

    const dueCell = document.createElement('td');
    dueCell.className = 'due-today-due-cell';
    const due = relativeDueLabel(subtask.due_date);
    const dueBadge = document.createElement('span');
    dueBadge.className = `deadline-due-label deadline-${due.variant}`;
    dueBadge.textContent = due.text;
    dueCell.appendChild(dueBadge);
    row.appendChild(dueCell);

    const objCell = document.createElement('td');
    objCell.className = 'due-today-objective';
    objCell.textContent = objectiveTitle;
    row.appendChild(objCell);

    tbody.appendChild(row);
  });

  table.appendChild(tbody);

  // Caps the panel to roughly two visible rows — the rest scroll into view
  // instead of pushing the Goals/Meetings panels further down the page.
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'objective-deadlines-scroll';
  scrollWrap.appendChild(table);
  panel.appendChild(scrollWrap);

  container.appendChild(panel);
}

async function loadObjectiveDeadlines() {
  const res = await fetch('/api/objectives');
  const objectives = await res.json();
  renderObjectiveDeadlinesPanel(objectives);
}

let completedSectionOpen = false;

function renderDay(data) {
  const sprintLabel = data.sprint.sprint_number
    ? `Sprint ${data.sprint.sprint_number} · ${data.sprint.start_date} → ${data.sprint.end_date}`
    : `${data.sprint.start_date} → ${data.sprint.end_date}`;
  document.getElementById('sprint-badge').textContent = sprintLabel;
  document.getElementById('day-total').textContent = `Total: ${formatDuration(data.totalSeconds) || '0m'}`;

  renderGoals(data.goals);

  const list = document.getElementById('task-list');
  list.innerHTML = '';

  // Cancelled meetings are kept in the database (so a resync doesn't recreate
  // them) but shouldn't clutter the visible list.
  const visibleTasks = data.tasks.filter((t) => t.status !== 'cancelled');
  const activeTasks = visibleTasks.filter((t) => t.status !== 'done');
  const completedTasks = visibleTasks.filter((t) => t.status === 'done');

  if (activeTasks.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No tasks yet for this day.';
    list.appendChild(li);
  } else {
    // Newest task first, so the most recent addition lands at the top of the page.
    [...activeTasks].reverse().forEach((task) =>
      list.appendChild(
        renderTaskItem(task, { showCompleteButton: true, showEditButton: true, showDeleteButton: true, onChange: loadDay })
      )
    );
  }

  renderCompletedSection(completedTasks);
}

// Completed tasks live in their own collapsed-by-default section, out of the
// way of the active list. Stays collapsed/expanded across re-renders since
// completedSectionOpen persists independently of the fetched data.
function renderCompletedSection(completedTasks) {
  const container = document.getElementById('completed-section');
  container.innerHTML = '';
  if (completedTasks.length === 0) return;

  const section = document.createElement('div');
  section.className = 'completed-section' + (completedSectionOpen ? ' open' : '');

  const header = document.createElement('div');
  header.className = 'completed-section-header';
  header.innerHTML = `<span>Completed (${completedTasks.length})</span><span class="completed-section-toggle">${completedSectionOpen ? '▾' : '▸'}</span>`;
  header.addEventListener('click', () => {
    completedSectionOpen = !completedSectionOpen;
    renderCompletedSection(completedTasks);
  });
  section.appendChild(header);

  const content = document.createElement('div');
  content.className = 'completed-section-content';
  const list = document.createElement('ul');
  list.className = 'task-list';
  [...completedTasks].reverse().forEach((task) =>
    list.appendChild(
      renderTaskItem(task, { showCompleteButton: true, showEditButton: true, showDeleteButton: true, onChange: loadDay })
    )
  );
  content.appendChild(list);
  section.appendChild(content);

  container.appendChild(section);
}

function renderGoals(goals) {
  const list = document.getElementById('goals-list');
  list.innerHTML = '';

  goals.forEach((goal) => {
    const li = document.createElement('li');
    li.className = 'goal-item' + (goal.done ? ' done' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!goal.done;
    checkbox.addEventListener('change', async () => {
      const justCompleted = checkbox.checked;
      await fetch(`/api/goals/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: checkbox.checked }),
      });
      const data = await loadDay();
      if (justCompleted && data.goals.length > 0 && data.goals.every((g) => g.done)) {
        celebrateGoalsComplete();
      }
    });
    li.appendChild(checkbox);

    const text = document.createElement('span');
    text.className = 'goal-text';
    text.textContent = goal.text;
    li.appendChild(text);

    const del = document.createElement('button');
    del.className = 'btn-delete';
    del.textContent = '×';
    del.title = 'Delete';
    del.addEventListener('click', async () => {
      await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' });
      loadDay();
    });
    li.appendChild(del);

    list.appendChild(li);
  });

  document.getElementById('add-goal-form').style.display = goals.length >= 3 ? 'none' : 'flex';

  const allDone = goals.length > 0 && goals.every((g) => g.done);
  document.getElementById('goals-complete-badge').hidden = !allDone;
}

const CONFETTI_COLORS = ['#3b5bdb', '#f59f00', '#2f9e44', '#e64980', '#7048e8', '#1c7ed6'];

function celebrateGoalsComplete() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const pieceCount = 120;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.backgroundColor = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.setProperty('--sway', `${Math.random() * 120 - 60}px`);
    piece.style.animationDuration = `${2.2 + Math.random() * 1.4}s`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 4000);
}

document.getElementById('add-goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('goal-text');
  const text = input.value.trim();
  if (!text) return;

  await fetch(`/api/days/${state.dayId}/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  input.value = '';
  loadDay();
});

// ---------- Calendar ----------
//
// Auto-loads with the day and refreshes itself in the background — the server
// pulls Google Calendar on its own timer, this just reads whatever it cached.

async function loadCalendarEvents() {
  const res = await fetch(`/api/calendar/day?date=${state.dateKey}`);
  const data = await res.json();
  if (!res.ok) {
    renderCalendarError(data.error || 'Failed to load calendar');
    return;
  }
  renderCalendarEvents(data.events, data.fetchedAt);
  // Meetings may have just been imported as tasks server-side — refresh the list.
  loadDayData();
}

function renderCalendarError(message) {
  document.getElementById('calendar-events-list').innerHTML = `<li class="empty-state">${escapeAttr(message)}</li>`;
  document.getElementById('calendar-updated').textContent = '';
}

function renderCalendarEvents(events, fetchedAt) {
  const list = document.getElementById('calendar-events-list');
  list.innerHTML = '';

  if (events.length === 0) {
    list.innerHTML = '<li class="empty-state">No meetings today.</li>';
  } else {
    events.forEach((ev) => {
      const li = document.createElement('li');
      li.className = 'calendar-event-item';

      const time = document.createElement('span');
      time.className = 'calendar-event-time';
      time.textContent = ev.allDay ? 'All day' : `${formatTime(ev.start)} – ${formatTime(ev.end)}`;
      li.appendChild(time);

      const title = document.createElement('span');
      title.textContent = ev.title;
      li.appendChild(title);

      list.appendChild(li);
    });
  }

  document.getElementById('calendar-updated').textContent = fetchedAt ? `Updated ${formatTime(fetchedAt)}` : '';
}

document.getElementById('refresh-calendar-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-calendar-btn');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/calendar/refresh?date=${state.dateKey}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      renderCalendarError(data.error || 'Failed to refresh calendar');
    } else {
      renderCalendarEvents(data.events, data.fetchedAt);
      loadDayData();
    }
  } finally {
    btn.disabled = false;
  }
});

setInterval(loadCalendarEvents, 5 * 60 * 1000);

// Shared task row used by both the Today view and the Sprints view.
// opts: { showCompleteButton, showEditButton, showDeleteButton, onChange }
function renderTaskItem(task, opts) {
  opts = opts || {};
  const li = document.createElement('li');
  li.className = 'task-item' + (task.status === 'done' ? ' done' : '');

  const row = document.createElement('div');
  row.className = 'task-row';

  const desc = document.createElement('span');
  desc.className = 'task-desc';
  desc.textContent = task.description;
  row.appendChild(desc);

  if (task.category) {
    const category = document.createElement('span');
    category.className = 'task-category-badge';
    category.textContent = task.category;
    const color = categoryColor(task.category);
    category.style.color = color;
    category.style.borderColor = `color-mix(in srgb, ${color} 45%, var(--border))`;
    category.style.background = `color-mix(in srgb, ${color} 15%, var(--card))`;
    row.appendChild(category);
  }

  if (task.status === 'done') {
    const status = document.createElement('span');
    status.className = 'task-status-done';
    status.textContent = `✓ ${formatDuration(task.duration_seconds)}`;
    row.appendChild(status);
  } else {
    const time = document.createElement('span');
    time.className = 'task-time';
    time.textContent = `started ${formatTime(task.start_time)}`;
    row.appendChild(time);

    if (opts.showCompleteButton) {
      const btn = document.createElement('button');
      btn.className = 'btn-complete';
      btn.textContent = 'Done';
      btn.addEventListener('click', async () => {
        await completeTask(task.id);
        if (opts.onChange) opts.onChange();
      });
      row.appendChild(btn);
    }
  }

  if (opts.showEditButton) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit task';
    editBtn.addEventListener('click', () => toggleEditTimesForm(li, task, opts));
    row.appendChild(editBtn);
  }

  if (opts.showEditButton && task.calendar_uid) {
    // Calendar-imported meetings use Cancel instead of Delete — deleting would
    // just get recreated by the next sync, since calendar_uid is how it dedupes.
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-delete';
    cancelBtn.textContent = '×';
    cancelBtn.title = 'Cancel this meeting';
    cancelBtn.addEventListener('click', async () => {
      await cancelTask(task.id);
      if (opts.onChange) opts.onChange();
    });
    row.appendChild(cancelBtn);
  } else if (opts.showDeleteButton && task.status !== 'done' && !task.calendar_uid) {
    const del = document.createElement('button');
    del.className = 'btn-delete';
    del.textContent = '×';
    del.title = 'Delete';
    del.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete task "${task.description}"?`))) return;
      await deleteTask(task.id);
      if (opts.onChange) opts.onChange();
    });
    row.appendChild(del);
  }

  li.appendChild(row);

  if (opts.showCompleteButton && task.status !== 'done') {
    li.appendChild(renderQuickLogForm(task, opts));
  }

  const subtasksSection = renderSubtasksSection(task, opts);
  if (subtasksSection) li.appendChild(subtasksSection);

  return li;
}

// Lets an open task be completed by entering how long it took directly on
// its row, as an alternative to the "Done" button (which uses the current
// time) or opening the full ✎ edit form.
function renderQuickLogForm(task, opts) {
  const form = document.createElement('form');
  form.className = 'quick-log-form';
  form.innerHTML = `
    <span class="quick-log-label">or log time spent</span>
    <div class="duration-inputs">
      <input type="number" name="hours" min="0" step="1" placeholder="0" /><span>h</span>
      <input type="number" name="minutes" min="0" max="59" step="1" placeholder="0" /><span>m</span>
    </div>
    <button type="submit">Log</button>
  `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hours = Number(form.elements.hours.value) || 0;
    const minutes = Number(form.elements.minutes.value) || 0;
    const totalMinutes = hours * 60 + minutes;
    if (totalMinutes <= 0) return;

    const start = new Date(task.start_time);
    const end = new Date(start.getTime() + totalMinutes * 60000);

    await fetch(`/api/tasks/${task.id}/times`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_time: task.start_time, end_time: end.toISOString() }),
    });

    if (opts.onChange) opts.onChange();
  });

  return form;
}

// Bulleted list of the sub-tasks attended during a task's time slot, plus an
// inline "add one at a time" form when editing is allowed for this view.
function renderSubtasksSection(task, opts) {
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  // Open tasks can always add a sub-task; a completed task only allows it
  // while its ✎ edit form is open.
  const canAddSubtask = opts.showEditButton && (task.status !== 'done' || openTaskEditIds.has(task.id));
  if (!hasSubtasks && !canAddSubtask) return null;

  const section = document.createElement('div');
  section.className = 'subtasks-section';

  if (hasSubtasks) {
    const list = document.createElement('ul');
    list.className = 'subtask-list';
    task.subtasks.forEach((sub) => {
      const item = document.createElement('li');
      item.className = 'subtask-item';

      const text = document.createElement('span');
      text.textContent = sub.text;
      item.appendChild(text);

      list.appendChild(item);
    });
    section.appendChild(list);
  }

  if (canAddSubtask) {
    const form = document.createElement('form');
    form.className = 'add-subtask-form';
    form.innerHTML = `<input type="text" placeholder="Add a sub-task..." /><button type="submit">Add</button>`;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      await fetch(`/api/tasks/${task.id}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (opts.onChange) opts.onChange();
    });
    section.appendChild(form);
  }

  return section;
}

function refreshSubtasksSection(li, task, opts) {
  const old = li.querySelector('.subtasks-section');
  if (old) old.remove();
  const updated = renderSubtasksSection(task, opts);
  if (updated) li.appendChild(updated);
}

function toggleEditTimesForm(li, task, opts) {
  const onChange = opts.onChange;
  const existing = li.querySelector('.edit-times-form');
  if (existing) {
    existing.remove();
    openTaskEditIds.delete(task.id);
    refreshSubtasksSection(li, task, opts);
    return;
  }

  openTaskEditIds.add(task.id);
  refreshSubtasksSection(li, task, opts);

  const form = document.createElement('form');
  form.className = 'edit-times-form';
  form.innerHTML = `
    <label class="edit-field-wide">Name<input type="text" name="description" value="${escapeAttr(task.description)}" required /></label>
    <label>Category<select name="category">${categoryOptionsHtml(task.category)}</select></label>
    <label>Start<input type="time" name="start" value="${toLocalTimeInputValue(task.start_time)}" required /></label>
    <label>End<input type="time" name="end" value="${toLocalTimeInputValue(task.end_time)}" /></label>
    <label class="duration-field">Or time spent
      <div class="duration-inputs">
        <input type="number" name="durationHours" min="0" step="1" placeholder="0" /><span>h</span>
        <input type="number" name="durationMinutes" min="0" max="59" step="1" placeholder="0" /><span>m</span>
      </div>
    </label>
    <button type="submit">Save</button>
    <button type="button" class="cancel">Cancel</button>
    <div class="edit-error"></div>
  `;

  form.querySelector('.cancel').addEventListener('click', () => {
    form.remove();
    openTaskEditIds.delete(task.id);
    refreshSubtasksSection(li, task, opts);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = form.elements.description.value.trim();
    const category = form.elements.category.value || null;
    const startValue = form.elements.start.value;
    const endValue = form.elements.end.value;
    const durationHoursValue = form.elements.durationHours.value.trim();
    const durationMinutesValue = form.elements.durationMinutes.value.trim();
    if (!description || !startValue) return;

    const errorBox = form.querySelector('.edit-error');

    const detailsRes = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, category }),
    });
    if (!detailsRes.ok) {
      const err = await detailsRes.json().catch(() => ({ error: 'Failed to save' }));
      errorBox.textContent = err.error || 'Failed to save';
      return;
    }

    const start = combineDateAndTime(task.start_time, startValue);
    const totalDurationMinutes = (Number(durationHoursValue) || 0) * 60 + (Number(durationMinutesValue) || 0);
    let endIso = null;
    if (totalDurationMinutes > 0) {
      // "Time spent" takes precedence over a typed End time when both are filled.
      endIso = new Date(start.getTime() + totalDurationMinutes * 60000).toISOString();
    } else if (endValue) {
      endIso = combineDateAndTime(task.start_time, endValue).toISOString();
    }

    const timesRes = await fetch(`/api/tasks/${task.id}/times`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_time: start.toISOString(),
        end_time: endIso,
      }),
    });
    if (!timesRes.ok) {
      const err = await timesRes.json().catch(() => ({ error: 'Failed to save' }));
      errorBox.textContent = err.error || 'Failed to save';
      return;
    }

    if (onChange) onChange();
  });

  li.appendChild(form);
}

async function completeTask(id) {
  await fetch(`/api/tasks/${id}/complete`, { method: 'PATCH' });
}

async function deleteTask(id) {
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
}

async function cancelTask(id) {
  await fetch(`/api/tasks/${id}/cancel`, { method: 'PATCH' });
}

// Once the user picks a category themselves, stop auto-suggesting for this entry.
let taskCategoryTouchedByUser = false;

document.getElementById('task-category').addEventListener('change', () => {
  taskCategoryTouchedByUser = true;
});

document.getElementById('task-description').addEventListener('input', (e) => {
  if (taskCategoryTouchedByUser) return;
  const guess = guessCategoryFromText(e.target.value);
  if (guess) document.getElementById('task-category').value = guess;
});

document.getElementById('add-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const categorySelect = document.getElementById('task-category');
  const description = document.getElementById('task-description').value.trim();
  const category = categorySelect.value || null;
  if (!description) return;

  await fetch(`/api/days/${state.dayId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, category }),
  });

  document.getElementById('task-description').value = '';
  categorySelect.value = DEFAULT_TASK_CATEGORY;
  taskCategoryTouchedByUser = false;
  loadDay();
});

// ---------- Sprints view ----------

// Sprint/day expand state, kept across loadSprints() re-renders (triggered by
// edits and additions) so the view doesn't collapse back after every change.
const openSprintIds = new Set();
const openDayIds = new Set();

async function loadSprints() {
  const res = await fetch('/api/sprints');
  const sprints = await res.json();
  const container = document.getElementById('sprint-list');
  container.innerHTML = '';

  if (sprints.length === 0) {
    container.innerHTML = '<div class="empty-state">No sprints yet.</div>';
    return;
  }

  sprints.forEach((sprint) => container.appendChild(renderSprintCard(sprint)));
  updateExportButton();
}

function updateExportButton() {
  const btn = document.getElementById('export-csv-btn');
  const hint = document.getElementById('export-hint');
  const count = state.selectedSprints.size;
  btn.disabled = count === 0;
  hint.textContent = count === 0 ? 'Select sprints below to export' : `${count} sprint${count > 1 ? 's' : ''} selected`;
}

document.getElementById('export-csv-btn').addEventListener('click', () => {
  if (state.selectedSprints.size === 0) return;
  const ids = [...state.selectedSprints].sort((a, b) => a - b).join(',');
  window.location.href = `/api/sprints/export?ids=${ids}`;
});

function renderSprintCard(sprint) {
  const card = document.createElement('div');
  card.className = 'sprint-card' + (openSprintIds.has(sprint.id) ? ' open' : '');

  const summary = document.createElement('div');
  summary.className = 'sprint-summary';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'sprint-select';
  checkbox.checked = state.selectedSprints.has(sprint.id);
  checkbox.addEventListener('click', (e) => e.stopPropagation());
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selectedSprints.add(sprint.id);
    else state.selectedSprints.delete(sprint.id);
    updateExportButton();
  });
  summary.appendChild(checkbox);

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = `${sprint.start_date} → ${sprint.end_date}`;
  summary.appendChild(title);

  const numberLabel = document.createElement('span');
  numberLabel.className = 'range';
  numberLabel.textContent = sprint.sprint_number ? `Sprint ${sprint.sprint_number}` : '';
  summary.appendChild(numberLabel);

  const editNumberBtn = document.createElement('button');
  editNumberBtn.type = 'button';
  editNumberBtn.className = 'btn-edit';
  editNumberBtn.title = sprint.sprint_number ? 'Edit sprint number' : 'Add sprint number';
  editNumberBtn.textContent = '✎';
  editNumberBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSprintNumberForm(card, sprint);
  });
  summary.appendChild(editNumberBtn);

  summary.addEventListener('click', () => {
    if (openSprintIds.has(sprint.id)) openSprintIds.delete(sprint.id);
    else openSprintIds.add(sprint.id);
    card.classList.toggle('open');
  });
  card.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'sprint-body';

  if (sprint.days.length === 0) {
    body.innerHTML = '<div class="empty-state">No days logged in this sprint.</div>';
  } else {
    sprint.days.forEach((day) => body.appendChild(renderDayBlock(day)));
  }

  card.appendChild(body);
  return card;
}

function toggleSprintNumberForm(card, sprint) {
  const existing = card.querySelector('.sprint-number-form');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.className = 'sprint-number-form';
  form.addEventListener('click', (e) => e.stopPropagation());
  form.innerHTML = `
    <input type="number" name="sprintNumber" placeholder="Sprint #" value="${sprint.sprint_number ?? ''}" />
    <button type="submit">Save</button>
    <button type="button" class="cancel">Cancel</button>
    <div class="edit-error"></div>
  `;

  form.querySelector('.cancel').addEventListener('click', (e) => {
    e.stopPropagation();
    form.remove();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = form.elements.sprintNumber.value.trim();

    const res = await fetch(`/api/sprints/${sprint.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprint_number: value === '' ? null : Number(value) }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save' }));
      form.querySelector('.edit-error').textContent = err.error || 'Failed to save';
      return;
    }

    loadSprints();
  });

  card.insertBefore(form, card.querySelector('.sprint-body'));
}

function renderDayBlock(day) {
  const block = document.createElement('div');
  block.className = 'day-block' + (openDayIds.has(day.id) ? ' open' : '');

  const header = document.createElement('div');
  header.className = 'day-block-header';
  header.innerHTML = `<span class="date">${formatDateLabel(day.date)}</span>`;
  header.addEventListener('click', () => {
    if (openDayIds.has(day.id)) openDayIds.delete(day.id);
    else openDayIds.add(day.id);
    block.classList.toggle('open');
  });
  block.appendChild(header);

  const content = document.createElement('div');
  content.className = 'day-block-content';

  const visibleTasks = day.tasks.filter((t) => t.status !== 'cancelled');

  if (visibleTasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No tasks.';
    content.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'task-list';
    visibleTasks.forEach((task) =>
      list.appendChild(
        renderTaskItem(task, { showEditButton: true, showCompleteButton: false, showDeleteButton: false, onChange: loadSprints })
      )
    );
    content.appendChild(list);
  }

  content.appendChild(renderAddDayTaskForm(day));

  block.appendChild(content);

  return block;
}

// Lets a forgotten task be logged onto a past sprint day directly from the
// Sprints tab, instead of having to revisit that date on the Today tab.
function renderAddDayTaskForm(day) {
  const form = document.createElement('form');
  form.className = 'add-day-task-form';
  form.addEventListener('click', (e) => e.stopPropagation());
  form.innerHTML = `
    <input type="text" name="description" placeholder="Add a task to this day..." required />
    <select name="category">${categoryOptionsHtml(null)}</select>
    <button type="submit">Add</button>
  `;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = form.elements.description.value.trim();
    if (!description) return;
    const category = form.elements.category.value || null;

    await fetch(`/api/days/${day.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, category }),
    });

    loadSprints();
  });

  return form;
}

// ---------- Statistics view ----------

let statsInitialized = false;

async function initStats() {
  if (!statsInitialized) {
    statsInitialized = true;
    await setStatsPreset('sprint');
  } else {
    loadStats();
  }
}

document.getElementById('stats-start').addEventListener('change', loadStats);
document.getElementById('stats-end').addEventListener('change', loadStats);

document.querySelectorAll('.stats-presets button').forEach((btn) => {
  btn.addEventListener('click', () => setStatsPreset(btn.dataset.preset));
});

async function setStatsPreset(preset) {
  const todayISO = todayKey();
  let startKey = todayISO;
  let endKey = todayISO;

  if (preset === 'sprint' || preset === 'lastSprint') {
    // Sprints are fixed 14-day blocks, so a date 14 days before today always
    // falls in the immediately preceding sprint — ask the server for its range.
    const anchorDate =
      preset === 'lastSprint' ? toDateKey(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)) : todayISO;
    const res = await fetch(`/api/day?date=${anchorDate}`);
    const data = await res.json();
    startKey = data.sprint.start_date;
    endKey = data.sprint.end_date;
  } else {
    const days = Number(preset);
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    startKey = toDateKey(start);
    endKey = toDateKey(end);
  }

  document.getElementById('stats-start').value = startKey;
  document.getElementById('stats-end').value = endKey;
  loadStats();
}

async function loadStats() {
  const start = document.getElementById('stats-start').value;
  const end = document.getElementById('stats-end').value;
  if (!start || !end) return;

  const res = await fetch(`/api/stats?start=${start}&end=${end}`);
  if (!res.ok) return;
  const data = await res.json();
  renderStatsSummary(data);
  renderStatsCategories(data);
}

function renderStatsCategories(data) {
  const container = document.getElementById('stats-categories');
  container.innerHTML = '';

  if (!data.categories || data.categories.length === 0) {
    container.innerHTML = '<div class="empty-state">No completed tasks in this range.</div>';
    return;
  }

  const maxSeconds = Math.max(...data.categories.map((c) => c.totalSeconds));

  data.categories.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'stats-category-row';

    const color = categoryColor(c.category);

    const name = document.createElement('div');
    name.className = 'stats-category-name';
    const dot = document.createElement('span');
    dot.className = 'stats-category-dot';
    dot.style.background = color;
    name.appendChild(dot);
    name.appendChild(document.createTextNode(c.category));
    row.appendChild(name);

    const track = document.createElement('div');
    track.className = 'stats-category-bar-track';
    const fill = document.createElement('div');
    fill.className = 'stats-category-bar-fill';
    fill.style.width = `${maxSeconds ? (c.totalSeconds / maxSeconds) * 100 : 0}%`;
    fill.style.background = color;
    track.appendChild(fill);
    row.appendChild(track);

    const value = document.createElement('div');
    value.className = 'stats-category-value';
    value.textContent = formatDuration(c.totalSeconds) || '0m';
    row.appendChild(value);

    container.appendChild(row);
  });
}

function renderStatsSummary(data) {
  const summary = document.getElementById('stats-summary');
  summary.innerHTML = '';

  const stats = [
    { label: 'Total hours', value: formatDuration(data.totalSeconds) || '0m' },
    { label: 'Days worked', value: String(data.workedDayCount) },
  ];

  stats.forEach((s) => {
    const box = document.createElement('div');
    box.className = 'stats-stat';
    box.innerHTML = `<div class="value">${s.value}</div><div class="label">${s.label}</div>`;
    summary.appendChild(box);
  });
}

// ---------- Notes ----------
//
// Entries are added via the form and listed read-only below it, one month at a time.

let noteCategoriesLoaded = false;
let notesMonth = null; // YYYY-MM of the month currently opened, or null

const NOTE_CATEGORY_COLORS = {
  Challenges: '#e8590c',
  Achievements: '#2f9e44',
  Mistakes: '#d64545',
  Learnings: '#3b5bdb',
};

function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// Month chips: the last 12 months plus any older month that has notes, oldest → newest.
async function loadNoteMonths() {
  const res = await fetch('/api/notes/months');
  const counts = new Map((await res.json()).map((r) => [r.month, r.count]));

  const current = todayKey().slice(0, 7);
  const months = new Set(counts.keys());
  for (let i = 0; i < 12; i++) months.add(shiftMonth(current, -i));
  const sorted = [...months].filter((m) => m <= current || counts.has(m)).sort();

  const strip = document.getElementById('notes-month-strip');
  strip.innerHTML = '';
  sorted.forEach((month) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const count = counts.get(month) || 0;
    chip.className = 'notes-month-chip' + (month === notesMonth ? ' active' : '') + (count ? '' : ' empty');
    chip.innerHTML = `<span>${escapeAttr(formatMonthLabel(month))}</span><span class="notes-month-count">${count}</span>`;
    chip.addEventListener('click', () => {
      notesMonth = notesMonth === month ? null : month;
      strip.querySelectorAll('.notes-month-chip').forEach((c) => c.classList.remove('active'));
      if (notesMonth) chip.classList.add('active');
      loadMonthNotes();
    });
    strip.appendChild(chip);
  });

  const active = strip.querySelector('.notes-month-chip.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  else strip.scrollLeft = strip.scrollWidth;
}

async function loadMonthNotes() {
  const list = document.getElementById('notes-month-list');
  list.innerHTML = '';
  if (!notesMonth) return;

  const res = await fetch(`/api/notes?month=${notesMonth}`);
  const notes = await res.json();

  const title = document.createElement('h2');
  title.className = 'notes-month-title';
  const [y, m] = notesMonth.split('-').map(Number);
  title.textContent = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  list.appendChild(title);

  if (notes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'notes-empty';
    empty.textContent = 'No notes for this month.';
    list.appendChild(empty);
    return;
  }

  const byDate = new Map();
  notes.forEach((n) => {
    if (!byDate.has(n.date)) byDate.set(n.date, []);
    byDate.get(n.date).push(n);
  });

  byDate.forEach((dayNotes, date) => {
    const group = document.createElement('div');
    group.className = 'notes-day';

    const heading = document.createElement('h3');
    heading.textContent = formatDateLabel(date);
    group.appendChild(heading);

    dayNotes.forEach((n) => {
      const item = document.createElement('div');
      item.className = 'note-item';

      const badge = document.createElement('span');
      badge.className = 'note-category-badge';
      badge.textContent = n.category;
      const color = NOTE_CATEGORY_COLORS[n.category] || 'var(--muted)';
      badge.style.color = color;
      badge.style.borderColor = `color-mix(in srgb, ${color} 45%, var(--border))`;
      badge.style.background = `color-mix(in srgb, ${color} 15%, var(--card))`;
      item.appendChild(badge);

      const text = document.createElement('p');
      text.className = 'note-text';
      text.textContent = n.text;
      item.appendChild(text);

      group.appendChild(item);
    });

    list.appendChild(group);
  });
}

document.getElementById('notes-scroll-left').addEventListener('click', () => {
  document.getElementById('notes-month-strip').scrollBy({ left: -300, behavior: 'smooth' });
});
document.getElementById('notes-scroll-right').addEventListener('click', () => {
  document.getElementById('notes-month-strip').scrollBy({ left: 300, behavior: 'smooth' });
});

async function initNotesTab() {
  if (!noteCategoriesLoaded) {
    noteCategoriesLoaded = true;
    const res = await fetch('/api/note-categories');
    const categories = await res.json();
    document.getElementById('note-category').innerHTML = categories
      .map((c) => `<option value="${escapeAttr(c)}">${escapeAttr(c)}</option>`)
      .join('');
  }
  const dateInput = document.getElementById('note-date');
  if (!dateInput.value) dateInput.value = state.dateKey;
  loadNoteMonths();
  loadMonthNotes();
}

document.getElementById('add-note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('note-date').value;
  const category = document.getElementById('note-category').value;
  const textInput = document.getElementById('note-text');
  const text = textInput.value.trim();
  const status = document.getElementById('note-save-status');
  if (!date || !category || !text) return;

  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, category, text }),
  });

  if (res.ok) {
    textInput.value = '';
    status.textContent = 'Saved.';
    status.className = 'note-save-status success';
    loadNoteMonths();
    if (notesMonth === date.slice(0, 7)) loadMonthNotes();
  } else {
    const err = await res.json().catch(() => ({ error: 'Failed to save' }));
    status.textContent = err.error || 'Failed to save';
    status.className = 'note-save-status error';
  }
});

// ---------- Decisions ----------
//
// Every objective's decisions in one table, with an editable "next step" per decision.

async function loadDecisions() {
  const res = await fetch('/api/objectives');
  const objectives = (await res.json()).filter((o) => o.decisions.length > 0);
  const wrap = document.getElementById('decisions-table-wrap');
  wrap.innerHTML = '';

  if (objectives.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'notes-empty';
    empty.textContent = 'No decisions yet. Add them from an objective on the Objectives tab.';
    wrap.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'decisions-table';
  table.innerHTML = `
    <thead>
      <tr><th>Objective</th><th>Decision</th><th>Next step</th><th>Status</th></tr>
    </thead>`;
  const tbody = document.createElement('tbody');

  objectives.forEach((objective) => {
    objective.decisions.forEach((d, i) => {
      const tr = document.createElement('tr');
      if (d.resolved) tr.classList.add('resolved');
      if (i === 0) tr.classList.add('objective-first-row');

      if (i === 0) {
        const objCell = document.createElement('td');
        objCell.className = 'decisions-objective';
        objCell.rowSpan = objective.decisions.length;
        objCell.textContent = objective.title;
        const status = document.createElement('div');
        status.className = 'decisions-objective-status';
        status.textContent = objective.status;
        objCell.appendChild(status);
        tr.appendChild(objCell);
      }

      const decisionCell = document.createElement('td');
      decisionCell.className = 'decisions-text';
      decisionCell.textContent = d.text;
      tr.appendChild(decisionCell);

      tr.appendChild(renderNextStepsCell(d));

      const statusCell = document.createElement('td');
      const toggle = document.createElement('label');
      toggle.className = 'decisions-status';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!d.resolved;
      checkbox.addEventListener('change', async () => {
        await fetch(`/api/objective-decisions/${d.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved: checkbox.checked }),
        });
        loadDecisions();
      });
      toggle.appendChild(checkbox);
      toggle.appendChild(document.createTextNode(d.resolved ? 'Decided' : 'Pending'));
      statusCell.appendChild(toggle);
      tr.appendChild(statusCell);

      tbody.appendChild(tr);
    });
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
}

// "Next steps" cell: a checklist of follow-ups for one decision, plus an
// explicit "+ Add next step" form so nothing depends on blur-to-save.
function renderNextStepsCell(decision) {
  const cell = document.createElement('td');
  cell.className = 'decisions-next';

  const list = document.createElement('ul');
  list.className = 'next-steps-list';
  (decision.next_steps || []).forEach((step) => {
    const li = document.createElement('li');
    li.className = 'next-step-item' + (step.done ? ' done' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!step.done;
    checkbox.title = 'Mark as done';
    checkbox.addEventListener('change', async () => {
      await fetch(`/api/decision-next-steps/${step.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: checkbox.checked }),
      });
      loadDecisions();
    });
    li.appendChild(checkbox);

    const text = document.createElement('span');
    text.className = 'next-step-text';
    text.textContent = step.text;
    li.appendChild(text);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-delete';
    del.textContent = '×';
    del.title = 'Delete next step';
    del.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete next step "${step.text}"?`))) return;
      await fetch(`/api/decision-next-steps/${step.id}`, { method: 'DELETE' });
      loadDecisions();
    });
    li.appendChild(del);

    list.appendChild(li);
  });
  cell.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'next-step-add-btn';
  addBtn.textContent = '+ Add next step';
  cell.appendChild(addBtn);

  const form = document.createElement('form');
  form.className = 'next-step-form';
  form.hidden = true;
  form.innerHTML = `
    <input type="text" placeholder="What happens next?" required />
    <div class="next-step-form-actions">
      <button type="button" class="next-step-cancel">Cancel</button>
      <button type="submit" class="next-step-save">Add</button>
    </div>
    <div class="next-step-error" hidden></div>`;
  const input = form.querySelector('input');
  const error = form.querySelector('.next-step-error');
  cell.appendChild(form);

  const closeForm = () => {
    form.hidden = true;
    addBtn.hidden = false;
    input.value = '';
    error.hidden = true;
  };
  addBtn.addEventListener('click', () => {
    form.hidden = false;
    addBtn.hidden = true;
    input.focus();
  });
  form.querySelector('.next-step-cancel').addEventListener('click', closeForm);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeForm();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const res = await fetch(`/api/objective-decisions/${decision.id}/next-steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => null);
    if (!res || !res.ok) {
      error.textContent = res && res.status === 404
        ? 'Couldn\'t save — restart the server to pick up the latest changes.'
        : 'Couldn\'t save the next step.';
      error.hidden = false;
      return;
    }
    loadDecisions();
  });

  return cell;
}

// ---------- Integrations ----------

async function loadIntegrationStatus() {
  const res = await fetch('/api/integrations/calendar');
  const data = await res.json();

  document.getElementById('integration-ics-url').value = data.icsUrl || '';
  document.getElementById('integration-disconnect-btn').hidden = !data.icsUrl;
  renderIntegrationStatus(data);
}

function renderIntegrationStatus(data) {
  const status = document.getElementById('integration-status');
  if (!data.icsUrl) {
    status.textContent = 'No calendar linked yet.';
    status.className = 'integration-status';
  } else if (data.error) {
    status.textContent = `Linked, but the last sync failed: ${data.error}`;
    status.className = 'integration-status error';
  } else {
    status.textContent = `Connected — last synced ${data.fetchedAt ? formatTime(data.fetchedAt) : 'just now'}.`;
    status.className = 'integration-status success';
  }
}

document.getElementById('integration-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('integration-ics-url');
  const icsUrl = input.value.trim();
  if (!icsUrl) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/integrations/calendar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icsUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      const status = document.getElementById('integration-status');
      status.textContent = data.error || 'Failed to save';
      status.className = 'integration-status error';
      return;
    }
    document.getElementById('integration-disconnect-btn').hidden = false;
    renderIntegrationStatus(data);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('integration-disconnect-btn').addEventListener('click', async () => {
  await fetch('/api/integrations/calendar', { method: 'DELETE' });
  document.getElementById('integration-ics-url').value = '';
  document.getElementById('integration-disconnect-btn').hidden = true;
  renderIntegrationStatus({ icsUrl: null });
});

// ---------- Objectives ----------
//
// Longer-running goals tracked over many days — distinct from the "Goals for
// the day" checklist on the Today view. Each has a status, a dated progress
// log, pending decisions, and sub-tasks with their own "complete by" date.

let objectiveStatuses = [];
let objectivePriorities = [];
let objectiveStatusesLoaded = false;
const openObjectiveIds = new Set();
let completedObjectivesOpen = false;

async function initObjectives() {
  if (!objectiveStatusesLoaded) {
    objectiveStatusesLoaded = true;
    const [statusesRes, prioritiesRes] = await Promise.all([
      fetch('/api/objective-statuses'),
      fetch('/api/objective-priorities'),
    ]);
    objectiveStatuses = await statusesRes.json();
    objectivePriorities = await prioritiesRes.json();
  }
  loadObjectives();
}

async function loadObjectives() {
  const res = await fetch('/api/objectives');
  const objectives = await res.json();
  updateObjectivesTabBadge(objectives);
  renderObjectivesView(objectives);
}

// Fetches just enough to keep the tab badge current even if the user hasn't
// opened the Objectives tab yet this session (e.g. right after page load).
async function refreshObjectivesBadge() {
  const res = await fetch('/api/objectives');
  const objectives = await res.json();
  updateObjectivesTabBadge(objectives);
}

// Pending sub-tasks due today, across any set of objectives (Done ones are
// always excluded — an objective that's finished has nothing left "due").
function computeDueTodaySubtasks(objectives) {
  const todayStr = todayKey();
  const dueToday = [];
  objectives
    .filter((o) => o.status !== 'Done')
    .forEach((o) => {
      o.subtasks.forEach((s) => {
        if (!s.done && s.due_date === todayStr) {
          dueToday.push({ subtask: s, objectiveId: o.id, objectiveTitle: o.title });
        }
      });
    });
  return dueToday;
}

function updateObjectivesTabBadge(objectives) {
  const count = computeDueTodaySubtasks(objectives).length;
  const badge = document.getElementById('objectives-due-badge');
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

// Pending sub-tasks (across all active objectives) due today, gathered into
// one glanceable table so nothing due today is buried inside a collapsed card.
function renderDueTodaySection(activeObjectives) {
  const container = document.getElementById('objectives-due-today');
  container.innerHTML = '';

  const dueToday = computeDueTodaySubtasks(activeObjectives);

  if (dueToday.length === 0) return;

  const panel = document.createElement('div');
  panel.className = 'due-today-panel';

  const heading = document.createElement('h3');
  heading.textContent = `Due today (${dueToday.length})`;
  panel.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'due-today-table';
  const tbody = document.createElement('tbody');

  dueToday.forEach(({ subtask, objectiveId, objectiveTitle }) => {
    const row = document.createElement('tr');

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.addEventListener('change', async () => {
      await fetch(`/api/objective-subtasks/${subtask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: checkbox.checked }),
      });
      loadObjectives();
    });
    checkboxCell.appendChild(checkbox);
    row.appendChild(checkboxCell);

    const textCell = document.createElement('td');
    textCell.className = 'due-today-text';
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'due-today-link';
    link.textContent = subtask.text;
    link.title = `Go to "${objectiveTitle}"`;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToObjective(objectiveId, subtask.id);
    });
    textCell.appendChild(link);
    row.appendChild(textCell);

    const objCell = document.createElement('td');
    objCell.className = 'due-today-objective';
    objCell.textContent = objectiveTitle;
    row.appendChild(objCell);

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  panel.appendChild(table);
  container.appendChild(panel);
}

function renderObjectivesView(objectives) {
  const active = objectives.filter((o) => o.status !== 'Done');
  const completed = objectives.filter((o) => o.status === 'Done');

  renderDueTodaySection(active);

  const activeContainer = document.getElementById('objectives-active');
  activeContainer.innerHTML = '';
  if (active.length === 0) {
    activeContainer.innerHTML = '<div class="empty-state">No objectives yet — add one above.</div>';
  } else {
    active.forEach((o) => activeContainer.appendChild(renderObjectiveCard(o)));
  }

  renderCompletedObjectivesSection(completed);
}

function renderCompletedObjectivesSection(completed) {
  const container = document.getElementById('objectives-completed-section');
  container.innerHTML = '';
  if (completed.length === 0) return;

  const section = document.createElement('div');
  section.className = 'completed-section' + (completedObjectivesOpen ? ' open' : '');

  const header = document.createElement('div');
  header.className = 'completed-section-header';
  header.innerHTML = `<span>Completed (${completed.length})</span><span class="completed-section-toggle">${completedObjectivesOpen ? '▾' : '▸'}</span>`;
  header.addEventListener('click', () => {
    completedObjectivesOpen = !completedObjectivesOpen;
    renderCompletedObjectivesSection(completed);
  });
  section.appendChild(header);

  const content = document.createElement('div');
  content.className = 'completed-section-content';
  completed.forEach((o) => content.appendChild(renderObjectiveCard(o)));
  section.appendChild(content);

  container.appendChild(section);
}

// Swaps an objective's title for an inline editable input, in place, without
// collapsing the card (which a full loadObjectives() re-render would do).
function toggleObjectiveTitleForm(titleWrap, objective) {
  const existingForm = titleWrap.querySelector('.objective-title-edit-form');
  const titleEl = titleWrap.querySelector('.objective-title');
  const editBtn = titleWrap.querySelector('.objective-title-edit-btn');

  if (existingForm) {
    existingForm.remove();
    titleEl.hidden = false;
    editBtn.hidden = false;
    return;
  }

  titleEl.hidden = true;
  editBtn.hidden = true;

  const form = document.createElement('form');
  form.className = 'objective-title-edit-form';
  form.addEventListener('click', (e) => e.stopPropagation());
  form.innerHTML = `
    <input type="text" name="title" value="${escapeAttr(objective.title)}" required />
    <button type="submit">Save</button>
    <button type="button" class="cancel">Cancel</button>
  `;

  form.querySelector('.cancel').addEventListener('click', (e) => {
    e.stopPropagation();
    form.remove();
    titleEl.hidden = false;
    editBtn.hidden = false;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    if (!title) return;
    await fetch(`/api/objectives/${objective.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    loadObjectives();
  });

  titleWrap.appendChild(form);
  form.querySelector('input').focus();
}

// Expands an objective's card, scrolls it into view and briefly highlights
// the given TO-DO inside it.
function jumpToObjective(objectiveId, subtaskId) {
  const card = document.querySelector(`.objective-card[data-objective-id="${objectiveId}"]`);
  if (!card) return;
  openObjectiveIds.add(objectiveId);
  card.classList.add('open');

  const target = (subtaskId && card.querySelector(`[data-subtask-id="${subtaskId}"]`)) || card;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('jump-highlight');
  void target.offsetWidth; // restart the animation if it's already applied
  target.classList.add('jump-highlight');
  setTimeout(() => target.classList.remove('jump-highlight'), 2000);
}

function renderObjectiveCard(objective) {
  const card = document.createElement('div');
  card.dataset.objectiveId = objective.id;
  card.className =
    'objective-card priority-' +
    objective.priority.toLowerCase() +
    (openObjectiveIds.has(objective.id) ? ' open' : '');

  const header = document.createElement('div');
  header.className = 'objective-header';
  header.addEventListener('click', () => {
    if (openObjectiveIds.has(objective.id)) openObjectiveIds.delete(objective.id);
    else openObjectiveIds.add(objective.id);
    card.classList.toggle('open');
  });

  const titleWrap = document.createElement('span');
  titleWrap.className = 'objective-title-wrap';

  const title = document.createElement('span');
  title.className = 'objective-title';
  title.textContent = objective.title;
  titleWrap.appendChild(title);

  const editTitleBtn = document.createElement('button');
  editTitleBtn.type = 'button';
  editTitleBtn.className = 'btn-edit objective-title-edit-btn';
  editTitleBtn.textContent = '✎';
  editTitleBtn.title = 'Edit title';
  editTitleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleObjectiveTitleForm(titleWrap, objective);
  });
  titleWrap.appendChild(editTitleBtn);

  header.appendChild(titleWrap);

  const prioritySelect = document.createElement('select');
  prioritySelect.className = 'objective-priority-select priority-' + objective.priority.toLowerCase();
  objectivePriorities.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === objective.priority) opt.selected = true;
    prioritySelect.appendChild(opt);
  });
  prioritySelect.addEventListener('click', (e) => e.stopPropagation());
  prioritySelect.addEventListener('change', async () => {
    await fetch(`/api/objectives/${objective.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: prioritySelect.value }),
    });
    loadObjectives();
  });
  header.appendChild(prioritySelect);

  const statusSelect = document.createElement('select');
  statusSelect.className = 'objective-status-select status-' + objective.status.toLowerCase().replace(/\s+/g, '-');
  objectiveStatuses.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    if (s === objective.status) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener('click', (e) => e.stopPropagation());
  statusSelect.addEventListener('change', async () => {
    await fetch(`/api/objectives/${objective.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: statusSelect.value }),
    });
    loadObjectives();
  });
  header.appendChild(statusSelect);

  const openSubtasks = objective.subtasks.filter((s) => !s.done).length;
  const openDecisions = objective.decisions.filter((d) => !d.resolved).length;
  const dueTodayCount = objective.subtasks.filter((s) => !s.done && s.due_date === todayKey()).length;
  const summaryBits = [];
  if (openSubtasks > 0) summaryBits.push(`${openSubtasks} TO-DO${openSubtasks > 1 ? 's' : ''}`);
  if (openDecisions > 0) summaryBits.push(`${openDecisions} decision${openDecisions > 1 ? 's' : ''}`);
  if (summaryBits.length > 0) {
    const summary = document.createElement('span');
    summary.className = 'objective-summary' + (dueTodayCount > 0 ? ' has-due-today' : '');
    summary.textContent = summaryBits.join(' · ');
    if (dueTodayCount > 0) summary.title = `${dueTodayCount} TO-DO${dueTodayCount > 1 ? 's' : ''} due today`;
    header.appendChild(summary);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-delete';
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Delete objective';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!(await confirmDialog(`Delete objective "${objective.title}"? This will also remove its updates, decisions and TO-DOs.`))) return;
    await fetch(`/api/objectives/${objective.id}`, { method: 'DELETE' });
    loadObjectives();
  });
  header.appendChild(deleteBtn);

  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'objective-body';
  body.appendChild(renderObjectiveUpdatesSection(objective));
  body.appendChild(renderObjectiveDecisionsSection(objective));
  body.appendChild(renderObjectiveSubtasksSection(objective));
  card.appendChild(body);

  return card;
}

function renderObjectiveUpdatesSection(objective) {
  const section = document.createElement('div');
  section.className = 'objective-subsection';

  const heading = document.createElement('h4');
  heading.textContent = '📝 Progress updates';
  section.appendChild(heading);

  if (objective.updates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No updates yet.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'objective-updates-list';
    objective.updates.forEach((u) => {
      const item = document.createElement('li');
      item.className = 'objective-update-item';

      const date = document.createElement('span');
      date.className = 'objective-update-date';
      date.textContent = formatDateLabel(u.date);
      item.appendChild(date);

      const text = document.createElement('span');
      text.className = 'objective-update-text';
      text.textContent = u.text;
      item.appendChild(text);

      const del = document.createElement('button');
      del.className = 'btn-delete';
      del.textContent = '×';
      del.title = 'Delete update';
      del.addEventListener('click', async () => {
        await fetch(`/api/objective-updates/${u.id}`, { method: 'DELETE' });
        loadObjectives();
      });
      item.appendChild(del);

      list.appendChild(item);
    });
    section.appendChild(list);
  }

  const form = document.createElement('form');
  form.className = 'add-objective-update-form';
  form.innerHTML = `
    <input type="date" name="date" value="${todayKey()}" required />
    <input type="text" name="text" placeholder="What happened today?" required />
    <button type="submit">Add</button>
  `;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = form.elements.date.value;
    const text = form.elements.text.value.trim();
    if (!date || !text) return;
    await fetch(`/api/objectives/${objective.id}/updates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, text }),
    });
    loadObjectives();
  });
  section.appendChild(form);

  return section;
}

function renderObjectiveDecisionsSection(objective) {
  const section = document.createElement('div');
  section.className = 'objective-subsection';

  const heading = document.createElement('h4');
  heading.textContent = '🧭 Decisions made';
  section.appendChild(heading);

  if (objective.decisions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No decisions made yet.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'objective-decisions-list';
    objective.decisions.forEach((d) => {
      const item = document.createElement('li');
      item.className = 'objective-decision-item' + (d.resolved ? ' resolved' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!d.resolved;
      checkbox.addEventListener('change', async () => {
        await fetch(`/api/objective-decisions/${d.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved: checkbox.checked }),
        });
        loadObjectives();
      });
      item.appendChild(checkbox);

      const text = document.createElement('span');
      text.className = 'objective-decision-text';
      text.textContent = d.text;
      item.appendChild(text);

      const del = document.createElement('button');
      del.className = 'btn-delete';
      del.textContent = '×';
      del.title = 'Delete decision';
      del.addEventListener('click', async () => {
        await fetch(`/api/objective-decisions/${d.id}`, { method: 'DELETE' });
        loadObjectives();
      });
      item.appendChild(del);

      list.appendChild(item);
    });
    section.appendChild(list);
  }

  const form = document.createElement('form');
  form.className = 'add-objective-decision-form';
  form.innerHTML = `
    <input type="text" placeholder="A decision that was made..." required />
    <button type="submit">Add</button>
  `;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    await fetch(`/api/objectives/${objective.id}/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    loadObjectives();
  });
  section.appendChild(form);

  return section;
}

// Swaps a sub-task's "by <date>" chip for a native date input in place, so
// the due date can be corrected without deleting and re-adding the sub-task.
function toggleSubtaskDueDateEdit(dueSpan, subtask) {
  if (dueSpan.nextSibling && dueSpan.nextSibling.classList && dueSpan.nextSibling.classList.contains('objective-subtask-due-edit')) {
    return;
  }

  dueSpan.hidden = true;

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'objective-subtask-due-edit';
  input.value = subtask.due_date;
  input.addEventListener('click', (e) => e.stopPropagation());

  const restore = () => {
    input.remove();
    dueSpan.hidden = false;
  };

  input.addEventListener('blur', restore);
  input.addEventListener('change', async () => {
    const value = input.value;
    if (!value || value === subtask.due_date) {
      restore();
      return;
    }
    await fetch(`/api/objective-subtasks/${subtask.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: value }),
    });
    loadObjectives();
  });

  dueSpan.insertAdjacentElement('afterend', input);
  input.focus();
  if (typeof input.showPicker === 'function') input.showPicker();
}

function renderObjectiveSubtasksSection(objective) {
  const section = document.createElement('div');
  section.className = 'objective-subsection';

  const heading = document.createElement('h4');
  heading.textContent = '✅ TO-DOs';
  section.appendChild(heading);

  if (objective.subtasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No TO-DOs yet.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'objective-subtasks-list';
    const todayStr = todayKey();
    objective.subtasks.forEach((s) => {
      const item = document.createElement('li');
      const overdue = !s.done && s.due_date < todayStr;
      item.className = 'objective-subtask-item' + (s.done ? ' done' : '') + (overdue ? ' overdue' : '');
      item.dataset.subtaskId = s.id;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!s.done;
      checkbox.addEventListener('change', async () => {
        await fetch(`/api/objective-subtasks/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ done: checkbox.checked }),
        });
        loadObjectives();
      });
      item.appendChild(checkbox);

      const text = document.createElement('span');
      text.className = 'objective-subtask-text';
      text.textContent = s.text;
      item.appendChild(text);

      const due = document.createElement('span');
      due.className = 'objective-subtask-due';
      due.textContent = `by ${formatDateLabel(s.due_date)}`;
      due.title = 'Click to change the due date';
      due.addEventListener('click', () => toggleSubtaskDueDateEdit(due, s));
      item.appendChild(due);

      const del = document.createElement('button');
      del.className = 'btn-delete';
      del.textContent = '×';
      del.title = 'Delete TO-DO';
      del.addEventListener('click', async () => {
        if (!(await confirmDialog(`Delete TO-DO "${s.text}"?`))) return;
        await fetch(`/api/objective-subtasks/${s.id}`, { method: 'DELETE' });
        loadObjectives();
      });
      item.appendChild(del);

      list.appendChild(item);
    });
    section.appendChild(list);
  }

  const form = document.createElement('form');
  form.className = 'add-objective-subtask-form';
  form.innerHTML = `
    <input type="text" name="text" placeholder="A step to complete..." required />
    <input type="date" name="dueDate" required />
    <button type="submit">Add</button>
  `;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    const dueDate = form.elements.dueDate.value;
    if (!text || !dueDate) return;
    await fetch(`/api/objectives/${objective.id}/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, due_date: dueDate }),
    });
    loadObjectives();
  });
  section.appendChild(form);

  return section;
}

document.getElementById('add-objective-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('objective-title');
  const title = input.value.trim();
  if (!title) return;
  await fetch('/api/objectives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  input.value = '';
  loadObjectives();
});

// ---------- Init ----------

loadDay();
refreshObjectivesBadge();
setInterval(refreshObjectivesBadge, 5 * 60 * 1000);
loadObjectiveDeadlines();
setInterval(loadObjectiveDeadlines, 5 * 60 * 1000);
