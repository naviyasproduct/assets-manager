'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { daysBetween, formatSpan, today, type Day } from '@/lib/days';
import {
  compareTasks,
  isOverdue,
  matchesFilter,
  mayChangeStatus,
  projectSpan,
  taskSpan,
  type ProjectRow,
  type TaskAbility,
  type TaskFilter,
  type TaskPerson,
  type TaskRow,
} from '@/lib/task-types';
import { Alert } from '@/components/ui';
import { Avatar } from '@/components/EmployeeManager';
import { ProjectDialog, TaskDialog, type TaskDraft } from '@/components/TaskForms';
import {
  PriorityFlag,
  ProjectDot,
  TaskCheck,
  TaskStatusPill,
  type TaskActions,
  type TaskGroup,
} from '@/components/TaskParts';
import { TaskGantt } from '@/components/TaskGantt';
import { TaskCalendar } from '@/components/TaskCalendar';

/**
 * The Tasks screen: one list of jobs, seen three ways. The list is for
 * working through them, the Gantt for how long things run and what overlaps,
 * the calendar for what is due when. All three edit the same tasks through the
 * same two calls - save a task, move its dates - so they can never disagree.
 */

type View = 'list' | 'gantt' | 'calendar';

const VIEW_KEY = 'tasks.view';
const DONE_KEY = 'tasks.showDone';

/**
 * Which dates a span becomes. A task kept on one date stays on that one date,
 * in the field it had, when it is dragged; stretched over several days it gets both.
 */
function datesFor(task: TaskRow, start: Day, end: Day): Pick<TaskRow, 'startDate' | 'dueDate'> {
  if (start === end) {
    if (task.startDate === null) return { startDate: null, dueDate: end };
    if (task.dueDate === null) return { startDate: start, dueDate: null };
  }
  return { startDate: start, dueDate: end };
}

export function TaskManager({
  projects,
  tasks: storedTasks,
  people,
  ability,
}: {
  projects: ProjectRow[];
  tasks: TaskRow[];
  people: TaskPerson[];
  ability: TaskAbility;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState<TaskFilter>({ query: '', personId: '', showDone: false });
  const [error, setError] = useState('');
  const [taskDialog, setTaskDialog] = useState<{ task?: TaskRow; draft?: TaskDraft } | null>(null);
  const [projectDialog, setProjectDialog] = useState<{ project?: ProjectRow } | null>(null);
  // Changes shown before the server confirms them, so a dragged bar does not
  // jump back while the page reloads. Dropped once fresh rows arrive.
  const [pending, setPending] = useState<Record<string, Partial<TaskRow>>>({});
  const now = useMemo(() => today(), []);

  useEffect(() => setPending({}), [storedTasks]);

  // The view and "show done" are how one person likes to read the page, so
  // they live in this browser. Blocked storage just means the defaults.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'list' || saved === 'gantt' || saved === 'calendar') setView(saved);
      if (localStorage.getItem(DONE_KEY) === '1') setFilter((f) => ({ ...f, showDone: true }));
    } catch {}
  }, []);

  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  const tasks = useMemo(
    () => storedTasks.map((t) => (pending[t.id] ? { ...t, ...pending[t.id] } : t)),
    [storedTasks, pending],
  );
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const filtering = filter.query.trim() !== '' || filter.personId !== '';

  /** Projects in name order, then the jobs that stand on their own. */
  const groups = useMemo(() => {
    const byProject = new Map<string | null, TaskRow[]>();
    for (const task of tasks) {
      const key = task.projectId && projectById.has(task.projectId) ? task.projectId : null;
      byProject.set(key, [...(byProject.get(key) ?? []), task]);
    }
    const build = (project: ProjectRow | null): TaskGroup => {
      const all = byProject.get(project?.id ?? null) ?? [];
      return {
        project,
        tasks: all.filter((t) => matchesFilter(t, filter, project?.name ?? null)).sort(compareTasks),
        total: all.length,
        done: all.filter((t) => t.status === 'DONE').length,
      };
    };
    return [...projects.map(build), build(null)];
  }, [tasks, projects, projectById, filter]);

  // A finished project goes quiet with "show done" off, like its tasks do. An
  // empty one stays, so it can be filled; with a search on, only hits show.
  const shownGroups = groups.filter((g) => {
    if (filtering) return g.tasks.length > 0;
    if (g.project === null) return g.tasks.length > 0;
    return filter.showDone || g.total === 0 || g.done < g.total;
  });
  const hiddenFinished = filtering || filter.showDone ? 0 : groups.filter((g) => g.project && g.total > 0 && g.done === g.total).length;

  const open = tasks.filter((t) => t.status !== 'DONE');
  const overdue = open.filter((t) => isOverdue(t, now)).length;
  const dueThisWeek = open.filter((t) => t.dueDate && t.dueDate >= now && daysBetween(now, t.dueDate) < 7).length;

  async function patch(task: TaskRow, change: Partial<TaskRow>) {
    setError('');
    setPending((p) => ({ ...p, [task.id]: { ...p[task.id], ...change } }));
    const result = await api(`/api/tasks/${task.id}`, { method: 'PATCH', json: change });
    if (!result.ok) {
      setError(result.error);
      setPending((p) => {
        const { [task.id]: _gone, ...rest } = p;
        return rest;
      });
      return;
    }
    router.refresh();
  }

  const actions: TaskActions = {
    open: (task) => setTaskDialog({ task }),
    create: (draft) => ability.edit && setTaskDialog({ draft }),
    editProject: (project) => ability.edit && setProjectDialog({ project }),
    move: (task, start, end) => {
      if (!ability.edit) return;
      const dates = datesFor(task, start, end);
      if (dates.startDate === task.startDate && dates.dueDate === task.dueDate) return;
      void patch(task, dates);
    },
    setStatus: (task, status) => {
      if (mayChangeStatus(task, ability) && status !== task.status) void patch(task, { status });
    },
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p>
            {open.length} open
            {dueThisWeek > 0 ? ` · ${dueThisWeek} due this week` : ''}
            {overdue > 0 ? (
              <>
                {' · '}
                <span className="task-overdue-count">{overdue} overdue</span>
              </>
            ) : null}
          </p>
        </div>
        {ability.edit ? (
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setProjectDialog({})}>
              + New project
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setTaskDialog({ draft: {} })}>
              + New task
            </button>
          </div>
        ) : null}
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <div className="card">
        <div className="toolbar task-toolbar">
          <div className="tabs" role="tablist" aria-label="View">
            {(
              [
                ['list', 'List'],
                ['gantt', 'Gantt'],
                ['calendar', 'Calendar'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                className={view === key ? 'is-on' : undefined}
                onClick={() => {
                  setView(key);
                  remember(VIEW_KEY, key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            placeholder="Search tasks…"
            aria-label="Search tasks"
          />
          <select
            aria-label="Assigned to"
            value={filter.personId}
            onChange={(e) => setFilter({ ...filter, personId: e.target.value })}
          >
            <option value="">Everyone</option>
            <option value={ability.userId}>Assigned to me</option>
            {people
              .filter((p) => p.id !== ability.userId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <label className="checkbox task-show-done">
            <input
              type="checkbox"
              checked={filter.showDone}
              onChange={(e) => {
                setFilter({ ...filter, showDone: e.target.checked });
                remember(DONE_KEY, e.target.checked ? '1' : '0');
              }}
            />
            Show done
          </label>
        </div>

        {tasks.length === 0 && projects.length === 0 ? (
          <div className="empty-state">
            <h3>Nothing to do yet</h3>
            <p>Add a task for a small job, or a project for a bigger one with several steps.</p>
            {ability.edit ? (
              <div className="row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setProjectDialog({})}>
                  + New project
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setTaskDialog({ draft: {} })}>
                  + New task
                </button>
              </div>
            ) : null}
          </div>
        ) : shownGroups.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: 0 }}>{filtering ? 'No task matches.' : 'Everything is done.'}</p>
          </div>
        ) : view === 'list' ? (
          <TaskList groups={shownGroups} peopleById={peopleById} ability={ability} actions={actions} now={now} />
        ) : view === 'gantt' ? (
          <TaskGantt groups={shownGroups} ability={ability} actions={actions} now={now} />
        ) : (
          <TaskCalendar
            groups={shownGroups}
            ability={ability}
            actions={actions}
            now={now}
            undated={shownGroups.reduce((n, g) => n + g.tasks.filter((t) => !taskSpan(t)).length, 0)}
          />
        )}

        {hiddenFinished > 0 ? (
          <div className="task-hidden-note">
            {hiddenFinished} finished project{hiddenFinished === 1 ? ' is' : 's are'} hidden.{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setFilter({ ...filter, showDone: true });
                remember(DONE_KEY, '1');
              }}
            >
              Show done
            </button>
          </div>
        ) : null}
      </div>

      {taskDialog ? (
        <TaskDialog
          task={taskDialog.task}
          draft={taskDialog.draft}
          projects={projects}
          people={people}
          ability={ability}
          onClose={() => setTaskDialog(null)}
        />
      ) : null}
      {projectDialog ? (
        <ProjectDialog
          project={projectDialog.project}
          taskCount={projectDialog.project ? tasks.filter((t) => t.projectId === projectDialog.project!.id).length : 0}
          onClose={() => setProjectDialog(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function People({ ids, peopleById }: { ids: string[]; peopleById: Map<string, TaskPerson> }) {
  const shown = ids.map((id) => peopleById.get(id)).filter((p): p is TaskPerson => !!p);
  if (shown.length === 0) return <span className="task-people task-people-empty" />;
  const names = shown.map((p) => p.name).join(', ');
  return (
    <span className="task-people" title={names} aria-label={`Assigned to ${names}`}>
      {shown.slice(0, 3).map((p) => (
        <Avatar key={p.id} name={p.name} photoUrl={p.photoUrl} size="sm" />
      ))}
      {shown.length > 3 ? <span className="task-people-more">+{shown.length - 3}</span> : null}
    </span>
  );
}

function TaskList({
  groups,
  peopleById,
  ability,
  actions,
  now,
}: {
  groups: TaskGroup[];
  peopleById: Map<string, TaskPerson>;
  ability: TaskAbility;
  actions: TaskActions;
  now: Day;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="task-groups">
      {groups.map((group) => {
        const key = group.project?.id ?? 'none';
        const isCollapsed = collapsed.has(key);
        const span = projectSpan(group.tasks);
        return (
          <section key={key} className="task-group">
            <div className="task-group-head">
              <button
                type="button"
                className="task-group-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => toggle(key)}
              >
                <span className={`task-caret${isCollapsed ? ' is-closed' : ''}`} aria-hidden="true">
                  ▾
                </span>
                <ProjectDot project={group.project} />
                <span className="task-group-name">{group.project?.name ?? 'Tasks on their own'}</span>
              </button>
              {group.project && span ? <span className="task-group-span">{formatSpan(span.start, span.end, now)}</span> : null}
              {group.project && group.total > 0 ? (
                <span className="task-progress" title={`${group.done} of ${group.total} done`}>
                  <span className="task-progress-bar">
                    <span style={{ width: `${(group.done / group.total) * 100}%` }} />
                  </span>
                  {group.done}/{group.total}
                </span>
              ) : null}
              {group.project && ability.edit ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.editProject(group.project!)}>
                  Edit project
                </button>
              ) : null}
            </div>
            {group.project?.description && !isCollapsed ? <p className="task-group-desc">{group.project.description}</p> : null}

            {isCollapsed ? null : (
              <>
                <ul className="task-rows">
                  {group.tasks.map((task) => {
                    const late = isOverdue(task, now);
                    const own = taskSpan(task);
                    return (
                      <li key={task.id} className={`task-row${task.status === 'DONE' ? ' is-done' : ''}`}>
                        <TaskCheck task={task} ability={ability} actions={actions} />
                        <button type="button" className="task-title" onClick={() => actions.open(task)}>
                          <span className="task-title-text">{task.title}</span>
                          <PriorityFlag priority={task.priority} />
                        </button>
                        <People ids={task.assigneeIds} peopleById={peopleById} />
                        <span className={`task-date${late ? ' is-late' : ''}${task.dueDate === now && task.status !== 'DONE' ? ' is-today' : ''}`}>
                          {own ? (task.dueDate === now && !task.startDate ? 'Today' : formatSpan(task.startDate, task.dueDate, now)) : ''}
                        </span>
                        <TaskStatusPill status={task.status} />
                      </li>
                    );
                  })}
                </ul>
                {ability.edit ? <QuickAdd projectId={group.project?.id ?? null} /> : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Type a title, press Enter, and the task is there - the fast way to empty a meeting's notes into the list. */
function QuickAdd({ projectId }: { projectId: string | null }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function add() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    const result = await api('/api/tasks', { method: 'POST', json: { title, projectId } });
    setBusy(false);
    if (!result.ok) {
      setError(result.fields?.title ?? result.error);
      return;
    }
    setTitle('');
    router.refresh();
    input.current?.focus();
  }

  return (
    <div className="task-quick-add">
      <span className="task-quick-plus" aria-hidden="true">
        +
      </span>
      <input
        ref={input}
        type="text"
        value={title}
        maxLength={200}
        placeholder="Add a task - type and press Enter"
        aria-label="Add a task"
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void add();
          }
          if (e.key === 'Escape') setTitle('');
        }}
      />
      {error ? <span className="err">{error}</span> : null}
    </div>
  );
}
