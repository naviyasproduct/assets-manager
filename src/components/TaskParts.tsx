'use client';

import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/format';
import type { Day } from '@/lib/days';
import { mayChangeStatus, type ProjectRow, type TaskAbility, type TaskRow } from '@/lib/task-types';
import type { TaskDraft } from '@/components/TaskForms';

/**
 * The small pieces the list, the Gantt and the calendar share, so a tick box
 * or a priority reads the same in every view. Kept apart from TaskManager so
 * the views depend on these and not on each other.
 */

export type TaskGroup = { project: ProjectRow | null; tasks: TaskRow[]; total: number; done: number };

/** What the views call back with. */
export type TaskActions = {
  open: (task: TaskRow) => void;
  create: (draft: TaskDraft) => void;
  editProject: (project: ProjectRow) => void;
  /** Moves or stretches a task on the timeline or the calendar. */
  move: (task: TaskRow, start: Day, end: Day) => void;
  setStatus: (task: TaskRow, status: TaskRow['status']) => void;
};

export function ProjectDot({ project }: { project: ProjectRow | null }) {
  return <span className={`task-dot tint-${project?.color ?? 'none'}`} aria-hidden="true" />;
}

export function PriorityFlag({ priority }: { priority: TaskRow['priority'] }) {
  if (priority === 'NORMAL') return null;
  return <span className={`task-priority task-priority-${priority.toLowerCase()}`}>{TASK_PRIORITY_LABELS[priority]}</span>;
}

export function TaskStatusPill({ status }: { status: TaskRow['status'] }) {
  const kind = status === 'DONE' ? 'ok' : status === 'IN_PROGRESS' ? 'accent' : 'neutral';
  return <span className={`pill pill-${kind}`}>{TASK_STATUS_LABELS[status]}</span>;
}

/**
 * The round box at the start of a row. To do and in progress tick to done;
 * done unticks back to to do. In progress shows half full.
 */
export function TaskCheck({ task, ability, actions }: { task: TaskRow; ability: TaskAbility; actions: TaskActions }) {
  const allowed = mayChangeStatus(task, ability);
  const done = task.status === 'DONE';
  return (
    <button
      type="button"
      className={`task-check task-check-${task.status.toLowerCase()}`}
      disabled={!allowed}
      aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
      title={allowed ? (done ? 'Mark as not done' : 'Mark as done') : TASK_STATUS_LABELS[task.status]}
      onClick={() => actions.setStatus(task, done ? 'TODO' : 'DONE')}
    >
      {done ? '✓' : null}
    </button>
  );
}
