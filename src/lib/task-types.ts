import type { TaskPriority, TaskStatus } from '@prisma/client';
import { maxDay, minDay, type Day } from '@/lib/days';

/**
 * The plain shapes the Tasks screen receives, and the few rules every view
 * of it must agree on - what span a task covers, what counts as overdue. No
 * `server-only`: the list, the Gantt and the calendar all read from here.
 */

/** The tile tints in globals.css; a project's bars take its colour. */
export const PROJECT_COLORS = ['blue', 'teal', 'violet', 'amber', 'green', 'rose', 'slate'] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export type TaskPerson = {
  id: string;
  name: string;
  jobTitle: string | null;
  photoUrl: string | null;
};

export type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  color: ProjectColor;
};

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  projectId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: Day | null;
  dueDate: Day | null;
  assigneeIds: string[];
  createdByName: string | null;
  createdAt: string;
};

/** What the browser may do, as the server worked it out. */
export type TaskAbility = {
  /** Add, plan and change anything. */
  edit: boolean;
  /** Who is looking - an assignee may still tick off their own task. */
  userId: string;
};

export function mayChangeStatus(task: Pick<TaskRow, 'assigneeIds'>, ability: TaskAbility): boolean {
  return ability.edit || task.assigneeIds.includes(ability.userId);
}

/**
 * The days a task covers. One date on its own is a one-day task on that day;
 * no dates at all means it is not on the timeline or the calendar yet.
 */
export function taskSpan(task: Pick<TaskRow, 'startDate' | 'dueDate'>): { start: Day; end: Day } | null {
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  return start && end ? { start, end } : null;
}

/** A project runs from its first task to its last. */
export function projectSpan(tasks: Array<Pick<TaskRow, 'startDate' | 'dueDate'>>): { start: Day; end: Day } | null {
  let span: { start: Day; end: Day } | null = null;
  for (const task of tasks) {
    const own = taskSpan(task);
    if (!own) continue;
    span = span ? { start: minDay(span.start, own.start), end: maxDay(span.end, own.end) } : own;
  }
  return span;
}

export function isOverdue(task: Pick<TaskRow, 'status' | 'dueDate'>, now: Day): boolean {
  return task.status !== 'DONE' && task.dueDate !== null && task.dueDate < now;
}

/** Open work first, then by when it is due (undated last), then oldest first. */
export function compareTasks(a: TaskRow, b: TaskRow): number {
  if ((a.status === 'DONE') !== (b.status === 'DONE')) return a.status === 'DONE' ? 1 : -1;
  const ad = a.dueDate ?? a.startDate;
  const bd = b.dueDate ?? b.startDate;
  if (ad !== bd) return ad === null ? 1 : bd === null ? -1 : ad < bd ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

export type TaskFilter = {
  query: string;
  /** '' for anyone, or a person's id. */
  personId: string;
  showDone: boolean;
};

export function matchesFilter(task: TaskRow, filter: TaskFilter, projectName: string | null): boolean {
  if (!filter.showDone && task.status === 'DONE') return false;
  if (filter.personId && !task.assigneeIds.includes(filter.personId)) return false;
  const q = filter.query.trim().toLowerCase();
  if (!q) return true;
  return [task.title, task.notes, projectName].some((text) => text?.toLowerCase().includes(q));
}
