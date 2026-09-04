const state = {
  dateKey: todayKey(),
  selectedSprints: new Set(),
  taskCategories: [],
  noteCategories: [],
};

const NOTE_CATEGORY_COLORS = {
  Challenges: '#fa5252',
  Achievements: '#12b886',
  Mistakes: '#f59f00',
  Learnings: '#1c7ed6',
};

function noteCategoryColor(category) {
  return NOTE_CATEGORY_COLORS[category] || '#868e96';
}

const CATEGORY_COLORS = {
  Research: '#1c7ed6',
  'Story writing': '#7048e8',
  Demo: '#f59f00',
  'Sanity testing': '#12b886',
  Presentations: '#e64980',
  Meetings: '#fa5252',
  Adhoc: '#82c91e',
  Support: '#15aabf',
  Uncategorized: '#868e96',
};

function categoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.Uncategorized;
}

// ---------- Task categories ----------

async function loadTaskCategories() {
  const res = await fetch('/api/task-categories');
  state.taskCategories = await res.json();
  populateCategorySelect(document.getElementById('task-category'), '');
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
    if (btn.dataset.tab === 'notes') initNotes();
  });
});

// ---------- Today view ----------

const datePicker = document.getElementById('date-picker');
datePicker.value = state.dateKey;
datePicker.addEventListener('change', () => {
  state.dateKey = datePicker.value;
  loadDay();
});

async function loadDay() {
  const res = await fetch(`/api/day?date=${state.dateKey}`);
  const data = await res.json();
  state.dayId = data.day.id;
  renderDay(data);
  return data;
}

function renderDay(data) {
  document.getElementById('sprint-badge').textContent =
    `Sprint ${data.sprint.sprint_number} (${data.sprint.start_date} → ${data.sprint.end_date})`;
  document.getElementById('day-total').textContent = `Total: ${formatDuration(data.totalSeconds) || '0m'}`;

  renderGoals(data.goals);

  const list = document.getElementById('task-list');
  list.innerHTML = '';

  if (data.tasks.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No tasks yet for this day.';
    list.appendChild(li);
    return;
  }

  data.tasks.forEach((task) =>
    list.appendChild(
      renderTaskItem(task, { showCompleteButton: true, showEditButton: true, showDeleteButton: true, onChange: loadDay })
    )
  );
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
    editBtn.addEventListener('click', () => toggleEditTimesForm(li, task, opts.onChange));
    row.appendChild(editBtn);
  }

  if (opts.showDeleteButton) {
    const del = document.createElement('button');
    del.className = 'btn-delete';
    del.textContent = '×';
    del.title = 'Delete';
    del.addEventListener('click', async () => {
      await deleteTask(task.id);
      if (opts.onChange) opts.onChange();
    });
    row.appendChild(del);
  }

  li.appendChild(row);

  if (task.comment) {
    const comment = document.createElement('div');
    comment.className = 'task-comment';
    comment.textContent = task.comment;
    li.appendChild(comment);
  }

  return li;
}

function toggleEditTimesForm(li, task, onChange) {
  const existing = li.querySelector('.edit-times-form');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.className = 'edit-times-form';
  form.innerHTML = `
    <label class="edit-field-wide">Name<input type="text" name="description" value="${escapeAttr(task.description)}" required /></label>
    <label>Category<select name="category">${categoryOptionsHtml(task.category)}</select></label>
    <label class="edit-field-wide">Comment<input type="text" name="comment" value="${escapeAttr(task.comment || '')}" /></label>
    <label>Start<input type="time" name="start" value="${toLocalTimeInputValue(task.start_time)}" required /></label>
    <label>End<input type="time" name="end" value="${toLocalTimeInputValue(task.end_time)}" /></label>
    <button type="submit">Save</button>
    <button type="button" class="cancel">Cancel</button>
    <div class="edit-error"></div>
  `;

  form.querySelector('.cancel').addEventListener('click', () => form.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = form.elements.description.value.trim();
    const category = form.elements.category.value || null;
    const comment = form.elements.comment.value.trim();
    const startValue = form.elements.start.value;
    const endValue = form.elements.end.value;
    if (!description || !startValue) return;

    const errorBox = form.querySelector('.edit-error');

    const detailsRes = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, comment, category }),
    });
    if (!detailsRes.ok) {
      const err = await detailsRes.json().catch(() => ({ error: 'Failed to save' }));
      errorBox.textContent = err.error || 'Failed to save';
      return;
    }

    const timesRes = await fetch(`/api/tasks/${task.id}/times`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_time: combineDateAndTime(task.start_time, startValue).toISOString(),
        end_time: endValue ? combineDateAndTime(task.start_time, endValue).toISOString() : null,
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

document.getElementById('add-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const categorySelect = document.getElementById('task-category');
  const description = document.getElementById('task-description').value.trim();
  const comment = document.getElementById('task-comment').value.trim();
  const category = categorySelect.value || null;
  if (!description) return;

  await fetch(`/api/days/${state.dayId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, comment, category }),
  });

  document.getElementById('task-description').value = '';
  document.getElementById('task-comment').value = '';
  categorySelect.value = '';
  loadDay();
});

// ---------- Sprints view ----------

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
  const numbers = [...state.selectedSprints].sort((a, b) => a - b).join(',');
  window.location.href = `/api/sprints/export?numbers=${numbers}`;
});

function renderSprintCard(sprint) {
  const card = document.createElement('div');
  card.className = 'sprint-card';

  const summary = document.createElement('div');
  summary.className = 'sprint-summary';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'sprint-select';
  checkbox.checked = state.selectedSprints.has(sprint.sprint_number);
  checkbox.addEventListener('click', (e) => e.stopPropagation());
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selectedSprints.add(sprint.sprint_number);
    else state.selectedSprints.delete(sprint.sprint_number);
    updateExportButton();
  });
  summary.appendChild(checkbox);

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = `Sprint ${sprint.sprint_number}`;
  summary.appendChild(title);

  const range = document.createElement('span');
  range.className = 'range';
  range.textContent = `${sprint.start_date} → ${sprint.end_date}`;
  summary.appendChild(range);

  const total = document.createElement('span');
  total.className = 'total';
  total.textContent = formatDuration(sprint.totalSeconds) || '0m';
  summary.appendChild(total);

  summary.addEventListener('click', () => card.classList.toggle('open'));
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

function renderDayBlock(day) {
  const block = document.createElement('div');
  block.className = 'day-block';

  const header = document.createElement('div');
  header.className = 'day-block-header';
  header.innerHTML = `<span class="date">${formatDateLabel(day.date)}</span><span>${formatDuration(day.totalSeconds) || '0m'}</span>`;
  header.addEventListener('click', () => block.classList.toggle('open'));
  block.appendChild(header);

  const content = document.createElement('div');
  content.className = 'day-block-content';

  if (day.tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No tasks.';
    content.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'task-list';
    day.tasks.forEach((task) =>
      list.appendChild(
        renderTaskItem(task, { showCompleteButton: false, showDeleteButton: false, onChange: loadSprints })
      )
    );
    content.appendChild(list);
  }

  block.appendChild(content);

  return block;
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

let notesInitialized = false;

async function initNotes() {
  if (!notesInitialized) {
    notesInitialized = true;
    const res = await fetch('/api/note-categories');
    state.noteCategories = await res.json();
    document.getElementById('note-category').innerHTML = noteCategoryOptionsHtml(state.noteCategories[0]);

    const monthInput = document.getElementById('notes-month');
    if (!monthInput.value) monthInput.value = state.dateKey.slice(0, 7);
    const dateInput = document.getElementById('note-date');
    if (!dateInput.value) dateInput.value = state.dateKey;
  }
  loadNotes();
}

document.getElementById('notes-month').addEventListener('change', loadNotes);

function noteCategoryOptionsHtml(selected) {
  return state.noteCategories
    .map((c) => `<option value="${escapeAttr(c)}"${c === selected ? ' selected' : ''}>${escapeAttr(c)}</option>`)
    .join('');
}

async function loadNotes() {
  const month = document.getElementById('notes-month').value;
  if (!month) return;

  const res = await fetch(`/api/notes?month=${month}`);
  if (!res.ok) return;
  renderNotesGroups(await res.json());
}

function renderNotesGroups(notes) {
  const container = document.getElementById('notes-groups');
  container.innerHTML = '';

  state.noteCategories.forEach((category) => {
    const group = document.createElement('div');
    group.className = 'notes-category-group';

    const heading = document.createElement('h3');
    const dot = document.createElement('span');
    dot.className = 'notes-category-dot';
    dot.style.background = noteCategoryColor(category);
    heading.appendChild(dot);
    heading.appendChild(document.createTextNode(category));
    group.appendChild(heading);

    const entries = notes.filter((n) => n.category === category);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No entries this month.';
      group.appendChild(empty);
    } else {
      entries.forEach((note) => group.appendChild(renderNoteItem(note)));
    }

    container.appendChild(group);
  });
}

function renderNoteItem(note) {
  const item = document.createElement('div');
  item.className = 'note-item';

  const date = document.createElement('div');
  date.className = 'note-date';
  date.textContent = formatDateLabel(note.date);
  item.appendChild(date);

  const text = document.createElement('div');
  text.className = 'note-text';
  text.textContent = note.text;
  item.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'note-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-edit';
  editBtn.textContent = '✎';
  editBtn.title = 'Edit note';
  editBtn.addEventListener('click', () => toggleEditNoteForm(item, note));
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-delete';
  delBtn.textContent = '×';
  delBtn.title = 'Delete';
  delBtn.addEventListener('click', async () => {
    await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
    loadNotes();
  });
  actions.appendChild(delBtn);

  item.appendChild(actions);
  return item;
}

function toggleEditNoteForm(item, note) {
  const existing = item.querySelector('.edit-note-form');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('form');
  form.className = 'edit-note-form';
  form.innerHTML = `
    <input type="date" name="date" value="${escapeAttr(note.date)}" required />
    <select name="category">${noteCategoryOptionsHtml(note.category)}</select>
    <textarea name="text" required>${escapeAttr(note.text)}</textarea>
    <button type="submit">Save</button>
    <button type="button" class="cancel">Cancel</button>
    <div class="edit-error"></div>
  `;

  form.querySelector('.cancel').addEventListener('click', () => form.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = form.elements.date.value;
    const category = form.elements.category.value;
    const text = form.elements.text.value.trim();
    if (!date || !text) return;

    const res = await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, category, text }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save' }));
      form.querySelector('.edit-error').textContent = err.error || 'Failed to save';
      return;
    }

    loadNotes();
  });

  item.appendChild(form);
}

document.getElementById('add-note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('note-date').value;
  const category = document.getElementById('note-category').value;
  const textInput = document.getElementById('note-text');
  const text = textInput.value.trim();
  if (!date || !category || !text) return;

  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, category, text }),
  });

  if (res.ok) {
    textInput.value = '';
    loadNotes();
  }
});

// ---------- Init ----------

loadDay();
