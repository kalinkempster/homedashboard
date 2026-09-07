import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

export function dueDate(task) {
  if (!task.last_done) return new Date();
  const d = new Date(task.last_done);
  d.setDate(d.getDate() + task.interval_days);
  return d;
}

export function daysUntil(task) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let due = dueDate(task);
  if (task.snoozed_to && new Date(task.snoozed_to) > due) due = new Date(task.snoozed_to);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}
