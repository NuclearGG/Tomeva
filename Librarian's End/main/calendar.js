'use strict';
// Circulation dates follow the workstation's local calendar, unlike audit timestamps.
function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function lateDays(due, now = new Date()) {
  const day = Date.parse(`${due}T00:00:00Z`);
  const current = Date.parse(`${localDate(now)}T00:00:00Z`);
  return Number.isFinite(day) ? Math.max(0, Math.round((current - day) / 86400000)) : 0;
}
function formatDate(value) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
module.exports = { localDate, lateDays, formatDate };
