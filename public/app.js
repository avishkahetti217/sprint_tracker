const state = {
  dateKey: todayKey(),
  selectedSprints: new Set(),
};

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

// Converts an ISO timestamp to the "YYYY-MM-DDTHH:mm" format datetime-local inputs need.
function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Tabs ----------

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'sprints') loadSprints();
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
}

function renderDay(data) {
  document.getElementById('sprint-badge').textContent =
    `Sprint ${data.sprint.sprint_number} (${data.sprint.start_date} → ${data.sprint.end_date})`;
  document.getElementById('day-total').textContent = `Total: ${formatDuration(data.totalSeconds) || '0m'}`;

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
    list.appendChild(renderTaskItem(task, { showCompleteButton: true, showDeleteButton: true, onChange: loadDay }))
  );
}

// Shared task row used by both the Today view and the Sprints view.
// opts: { showCompleteButton, showDeleteButton, onChange }
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

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-edit';
  editBtn.textContent = '✎';
  editBtn.title = 'Edit start/end time';
  editBtn.addEventListener('click', () => toggleEditTimesForm(li, task, opts.onChange));
  row.appendChild(editBtn);

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
    <label>Start<input type="datetime-local" name="start" value="${toLocalInputValue(task.start_time)}" required /></label>
    <label>End<input type="datetime-local" name="end" value="${toLocalInputValue(task.end_time)}" /></label>
    <button type="submit">Save</button>
    <button type="button" class="cancel">Cancel</button>
    <div class="edit-error"></div>
  `;

  form.querySelector('.cancel').addEventListener('click', () => form.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const startValue = form.elements.start.value;
    const endValue = form.elements.end.value;
    if (!startValue) return;

    const res = await fetch(`/api/tasks/${task.id}/times`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_time: new Date(startValue).toISOString(),
        end_time: endValue ? new Date(endValue).toISOString() : null,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save' }));
      form.querySelector('.edit-error').textContent = err.error || 'Failed to save';
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
  const description = document.getElementById('task-description').value.trim();
  const comment = document.getElementById('task-comment').value.trim();
  if (!description) return;

  await fetch(`/api/days/${state.dayId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, comment }),
  });

  document.getElementById('task-description').value = '';
  document.getElementById('task-comment').value = '';
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
  block.appendChild(header);

  if (day.tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No tasks.';
    block.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'task-list';
    day.tasks.forEach((task) =>
      list.appendChild(
        renderTaskItem(task, { showCompleteButton: false, showDeleteButton: false, onChange: loadSprints })
      )
    );
    block.appendChild(list);
  }

  return block;
}

// ---------- Init ----------

loadDay();
