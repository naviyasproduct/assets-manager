'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { formatDateTime, TASK_PRIORITY_LABELS, TASK_PRIORITY_ORDER, TASK_STATUS_LABELS, TASK_STATUS_ORDER } from '@/lib/format';
import {
  PROJECT_COLORS,
  mayChangeStatus,
  type ProjectColor,
  type ProjectRow,
  type TaskAbility,
  type TaskPerson,
  type TaskRow,
} from '@/lib/task-types';
import { Alert, ConfirmDialog, Field, Modal } from '@/components/ui';
import { Avatar } from '@/components/EmployeeManager';

/** What a new task starts from: the group it was added in, the day it was clicked on. */
export type TaskDraft = Partial<Pick<TaskRow, 'projectId' | 'startDate' | 'dueDate'>>;

type TaskForm = {
  title: string;
  notes: string;
  projectId: string;
  status: TaskRow['status'];
  priority: TaskRow['priority'];
  startDate: string;
  dueDate: string;
  assigneeIds: string[];
};

const COLOR_NAMES: Record<ProjectColor, string> = {
  blue: 'Blue',
  teal: 'Teal',
  violet: 'Violet',
  amber: 'Amber',
  green: 'Green',
  rose: 'Rose',
  slate: 'Grey',
};

/**
 * Adding a task, or opening one. Someone without tasks Edit sees it read-only,
 * except the status when the task is theirs - the same line the server draws.
 */
export function TaskDialog({
  task,
  draft,
  projects,
  people,
  ability,
  onClose,
}: {
  task?: TaskRow;
  draft?: TaskDraft;
  projects: ProjectRow[];
  people: TaskPerson[];
  ability: TaskAbility;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<TaskForm>({
    title: task?.title ?? '',
    notes: task?.notes ?? '',
    projectId: task?.projectId ?? draft?.projectId ?? '',
    status: task?.status ?? 'TODO',
    priority: task?.priority ?? 'NORMAL',
    startDate: task?.startDate ?? draft?.startDate ?? '',
    dueDate: task?.dueDate ?? draft?.dueDate ?? '',
    assigneeIds: task?.assigneeIds ?? [],
  });
  const [projectList, setProjectList] = useState(projects);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);

  const canEdit = ability.edit;
  const canStatus = task ? mayChangeStatus(task, ability) : canEdit;
  const set = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const chosen = form.assigneeIds.map((id) => people.find((p) => p.id === id)).filter((p): p is TaskPerson => !!p);
  const addable = people.filter((p) => !form.assigneeIds.includes(p.id));

  async function save() {
    setBusy(true);
    setError('');
    setFields({});
    // Without Edit the only thing that may go is the status; sending the rest
    // unchanged would still be refused by the server.
    const body = canEdit ? { ...form, projectId: form.projectId || null } : { status: form.status };
    const result = await api(task ? `/api/tasks/${task.id}` : '/api/tasks', {
      method: task ? 'PATCH' : 'POST',
      json: body,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!task) return;
    setBusy(true);
    const result = await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!result.ok) {
      setDeleting(false);
      setError(result.error);
      return;
    }
    onClose();
    router.refresh();
  }

  async function createProject() {
    if (!newProject?.trim()) return;
    setBusy(true);
    const color = PROJECT_COLORS[projectList.length % PROJECT_COLORS.length];
    const result = await api<{ project: ProjectRow }>('/api/projects', {
      method: 'POST',
      json: { name: newProject, color },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.fields?.name ?? result.error);
      return;
    }
    setProjectList((list) => [...list, result.data.project]);
    set('projectId', result.data.project.id);
    setNewProject(null);
  }

  const title = task ? (canEdit ? 'Edit task' : 'Task') : 'New task';

  return (
    <>
      <Modal
        title={title}
        onClose={busy ? () => {} : onClose}
        wide
        footer={
          <>
            {task && canEdit ? (
              <button type="button" className="btn btn-ghost task-delete" onClick={() => setDeleting(true)} disabled={busy}>
                Delete
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              {canEdit || canStatus ? 'Cancel' : 'Close'}
            </button>
            {canEdit || canStatus ? (
              <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : task ? 'Save' : 'Add task'}
              </button>
            ) : null}
          </>
        }
      >
        {error ? <Alert>{error}</Alert> : null}
        {task && !canEdit ? (
          <Alert kind="info">
            {canStatus
              ? 'This task is yours: you can change its status. Planning it is for someone with tasks Edit.'
              : 'You can see this task. Changing it needs tasks Edit.'}
          </Alert>
        ) : null}

        <Field label="Task" htmlFor="t-title" error={fields.title}>
          <input
            id="t-title"
            type="text"
            className="task-title-input"
            value={form.title}
            maxLength={200}
            autoFocus={canEdit}
            disabled={!canEdit}
            placeholder="What needs doing"
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>

        <div className="field-row field-row-auto">
          <Field label="Project" htmlFor="t-project" error={fields.projectId}>
            <select
              id="t-project"
              value={form.projectId}
              disabled={!canEdit}
              onChange={(e) => {
                if (e.target.value === '__new') setNewProject('');
                else set('projectId', e.target.value);
              }}
            >
              <option value="">None - a task on its own</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {canEdit ? <option value="__new">+ New project…</option> : null}
            </select>
          </Field>
          <Field label="Status" htmlFor="t-status" error={fields.status}>
            <select
              id="t-status"
              value={form.status}
              disabled={!canStatus}
              onChange={(e) => set('status', e.target.value as TaskRow['status'])}
            >
              {TASK_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority" htmlFor="t-priority" error={fields.priority}>
            <select
              id="t-priority"
              value={form.priority}
              disabled={!canEdit}
              onChange={(e) => set('priority', e.target.value as TaskRow['priority'])}
            >
              {TASK_PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {newProject !== null ? (
          <div className="inline-panel">
            <div className="inline-panel-head">New project</div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <input
                type="text"
                value={newProject}
                maxLength={120}
                autoFocus
                aria-label="Project name"
                placeholder="e.g. Shed B roof"
                style={{ flex: 1 }}
                onChange={(e) => setNewProject(e.target.value)}
                onKeyDown={(e) => {
                  // Enter here makes the project, not the task.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void createProject();
                  }
                }}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !newProject.trim()} onClick={createProject}>
                Create
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setNewProject(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="field-row field-row-auto">
          <Field label="Start" htmlFor="t-start" error={fields.startDate} hint="Optional. Leave it for a one-day job.">
            <input
              id="t-start"
              type="date"
              value={form.startDate}
              disabled={!canEdit}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </Field>
          <Field label="Due" htmlFor="t-due" error={fields.dueDate}>
            <input
              id="t-due"
              type="date"
              value={form.dueDate}
              min={form.startDate || undefined}
              disabled={!canEdit}
              onChange={(e) => set('dueDate', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Assigned to" error={fields.assigneeIds}>
          <div className="task-assignees">
            {chosen.map((person) => (
              <span key={person.id} className="task-assignee">
                <Avatar name={person.name} photoUrl={person.photoUrl} size="sm" />
                {person.name}
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Take ${person.name} off this task`}
                    onClick={() => set('assigneeIds', form.assigneeIds.filter((id) => id !== person.id))}
                  >
                    ✕
                  </button>
                ) : null}
              </span>
            ))}
            {canEdit && addable.length > 0 ? (
              <select
                aria-label="Assign someone"
                className="task-assign-select"
                value=""
                onChange={(e) => e.target.value && set('assigneeIds', [...form.assigneeIds, e.target.value])}
              >
                <option value="">+ Assign someone…</option>
                {addable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.jobTitle ? ` - ${p.jobTitle}` : ''}
                  </option>
                ))}
              </select>
            ) : null}
            {chosen.length === 0 && !canEdit ? <span className="muted">Nobody yet</span> : null}
          </div>
        </Field>

        <Field label="Notes" htmlFor="t-notes" error={fields.notes}>
          <textarea
            id="t-notes"
            rows={4}
            value={form.notes}
            maxLength={4000}
            disabled={!canEdit}
            placeholder="Anything the person doing it should know."
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>

        {task ? (
          <p className="muted task-added-by">
            Added {formatDateTime(task.createdAt)}
            {task.createdByName ? ` by ${task.createdByName}` : ''}
          </p>
        ) : null}
      </Modal>

      {deleting && task ? (
        <ConfirmDialog
          title="Delete this task?"
          message={`"${task.title}" is removed for good. To keep it on record, mark it done instead.`}
          confirmLabel="Delete task"
          busy={busy}
          onCancel={() => setDeleting(false)}
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}

/** A project: a name, a colour for its bars, and a line on what it is for. */
export function ProjectDialog({
  project,
  taskCount,
  onClose,
}: {
  project?: ProjectRow;
  taskCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
    color: (project?.color ?? 'blue') as ProjectColor,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);

  async function save() {
    setBusy(true);
    setError('');
    setFields({});
    const result = await api(project ? `/api/projects/${project.id}` : '/api/projects', {
      method: project ? 'PATCH' : 'POST',
      json: form,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!project) return;
    setBusy(true);
    const result = await api(`/api/projects/${project.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!result.ok) {
      setDeleting(false);
      setError(result.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <>
      <Modal
        title={project ? 'Edit project' : 'New project'}
        onClose={busy ? () => {} : onClose}
        footer={
          <>
            {project ? (
              <button type="button" className="btn btn-ghost task-delete" onClick={() => setDeleting(true)} disabled={busy}>
                Delete
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : project ? 'Save' : 'Create project'}
            </button>
          </>
        }
      >
        {error ? <Alert>{error}</Alert> : null}
        <Field label="Name" htmlFor="p-name" error={fields.name}>
          <input
            id="p-name"
            type="text"
            value={form.name}
            maxLength={120}
            autoFocus
            placeholder="e.g. Shed B roof"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Colour" error={fields.color}>
          <div className="color-pick" role="radiogroup" aria-label="Colour">
            {PROJECT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={form.color === color}
                aria-label={COLOR_NAMES[color]}
                title={COLOR_NAMES[color]}
                className={`color-swatch tint-${color}${form.color === color ? ' is-on' : ''}`}
                onClick={() => setForm({ ...form, color })}
              />
            ))}
          </div>
        </Field>
        <Field label="What it is for" htmlFor="p-desc" error={fields.description} hint="Optional. Shown under the project's name.">
          <textarea
            id="p-desc"
            rows={3}
            value={form.description}
            maxLength={2000}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          A project runs from its first task to its last - add tasks with dates and it appears on the Gantt.
        </p>
      </Modal>

      {deleting && project ? (
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          message={
            taskCount > 0
              ? `The project goes. Its ${taskCount} task${taskCount === 1 ? ' stays' : 's stay'}, as task${taskCount === 1 ? '' : 's'} on ${taskCount === 1 ? 'its' : 'their'} own.`
              : 'The project goes. It has no tasks.'
          }
          confirmLabel="Delete project"
          busy={busy}
          onCancel={() => setDeleting(false)}
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
