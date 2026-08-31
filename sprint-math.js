// Sprints are fixed 2-week blocks (Monday to Friday of the following week),
// numbered consistently from a fixed anchor Monday so a given date always
// maps to the same sprint number regardless of when it's entered.
const ANCHOR = new Date(2026, 7, 24); // Monday, start of Sprint 134
const ANCHOR_SPRINT_NUMBER = 134;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function computeSprintForDate(dateKey) {
  const date = dateOnly(parseDateKey(dateKey));
  const anchor = dateOnly(ANCHOR);
  const diffDays = Math.round((date - anchor) / DAY_MS);
  const diffWeeks = Math.floor(diffDays / 7);
  const sprintOffset = Math.floor(diffWeeks / 2);
  const sprintStart = new Date(anchor.getTime() + sprintOffset * 14 * DAY_MS);
  const sprintEnd = new Date(sprintStart.getTime() + 11 * DAY_MS); // Friday of week 2

  return {
    sprintNumber: ANCHOR_SPRINT_NUMBER + sprintOffset,
    startDate: toDateKey(sprintStart),
    endDate: toDateKey(sprintEnd),
  };
}

module.exports = { toDateKey, parseDateKey, computeSprintForDate };
