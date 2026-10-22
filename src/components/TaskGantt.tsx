'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  daysBetween,
  formatMonth,
  formatSpan,
  maxDay,
  minDay,
  weekdayOf,
  type Day,
} from '@/lib/days';
import { TASK_STATUS_LABELS } from '@/lib/format';
import { isOverdue, projectSpan, taskSpan, type TaskAbility, type TaskRow } from '@/lib/task-types';
import { ProjectDot, TaskCheck, type TaskActions, type TaskGroup } from '@/components/TaskParts';

/**
 * Every task as a bar across the days it runs, grouped under its project,
 * whose own bar runs from its first task to its last and fills as tasks are
 * ticked off. With tasks Edit a bar is dragged to move it and by either end
 * to change when it starts or finishes; a click without moving opens it. A
 * task with no dates gets its row anyway, and a click on a day places it.
 *
 * Plain elements on a day grid, no chart library: the bars are buttons, so
 * they take focus and Enter like everything else.
 */

const ZOOM = { weeks: 36, months: 14 } as const;
type Zoom = keyof typeof ZOOM;

type Drag = {
  id: string;
  mode: 'move' | 'start' | 'end';
  x0: number;
  start: Day;
  end: Day;
  delta: number;
};

/** The span a bar shows while it is being dragged. */
function dragged(drag: Drag): { start: Day; end: Day } {
  if (drag.mode === 'move') return { start: addDays(drag.start, drag.delta), end: addDays(drag.end, drag.delta) };
  if (drag.mode === 'start') return { start: minDay(addDays(drag.start, drag.delta), drag.end), end: drag.end };
  return { start: drag.start, end: maxDay(addDays(drag.end, drag.delta), drag.start) };
}

export function TaskGantt({
  groups,
  ability,
  actions,
  now,
}: {
  groups: TaskGroup[];
  ability: TaskAbility;
  actions: TaskActions;
  now: Day;
}) {
  const [zoom, setZoom] = useState<Zoom>('weeks');
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dayW = ZOOM[zoom];

  // From a little before the earliest task (or today) to a little after the
  // latest, never less than about two months, so there is room to drag into.
  const range = useMemo(() => {
    let first = addDays(now, -14);
    let last = addDays(now, 45);
    for (const group of groups) {
      for (const task of group.tasks) {
        const span = taskSpan(task);
        if (!span) continue;
        first = minDay(first, addDays(span.start, -7));
        last = maxDay(last, addDays(span.end, 14));
      }
    }
    // Start on a Monday so the week lines fall on whole weeks.
    first = addDays(first, -weekdayOf(first));
    return { first, days: daysBetween(first, last) + 1 };
  }, [groups, now]);

  const days = useMemo(() => Array.from({ length: range.days }, (_, i) => addDays(range.first, i)), [range]);
  const months = useMemo(() => {
    const out: Array<{ label: string; from: number; count: number }> = [];
    days.forEach((day, i) => {
      const last = out[out.length - 1];
      if (last && days[last.from].slice(0, 7) === day.slice(0, 7)) last.count += 1;
      else out.push({ label: formatMonth(day), from: i, count: 1 });
    });
    return out;
  }, [days]);

  const x = (day: Day) => daysBetween(range.first, day) * dayW;
  const todayX = x(now);

  // Opens with today a little in from the left, rather than at the start of the range.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - dayW * 7);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  function begin(event: React.PointerEvent, task: TaskRow, mode: Drag['mode']) {
    const span = taskSpan(task);
    if (!span || event.button !== 0) return;
    event.stopPropagation();
    if (!ability.edit) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({ id: task.id, mode, x0: event.clientX, start: span.start, end: span.end, delta: 0 });
  }

  function follow(event: React.PointerEvent) {
    if (!drag) return;
    const delta = Math.round((event.clientX - drag.x0) / dayW);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  }

  function finish(task: TaskRow) {
    if (!drag) return;
    const span = dragged(drag);
    setDrag(null);
    if (drag.delta === 0) {
      if (drag.mode === 'move') actions.open(task);
      return;
    }
    actions.move(task, span.start, span.end);
  }

  /** A click on an empty track: an undated task is placed on that day. */
  function place(event: React.MouseEvent<HTMLDivElement>, task: TaskRow) {
    if (!ability.edit || taskSpan(task)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const day = addDays(range.first, Math.floor((event.clientX - rect.left) / dayW));
    actions.move(task, day, day);
  }

  const width = range.days * dayW;

  return (
    <div className="gantt-wrap">
      <div className="gantt-bar">
        <div className="tabs" role="tablist" aria-label="Zoom">
          {(['weeks', 'months'] as const).map((z) => (
            <button key={z} type="button" role="tab" aria-selected={zoom === z} className={zoom === z ? 'is-on' : undefined} onClick={() => setZoom(z)}>
              {z === 'weeks' ? 'Weeks' : 'Months'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => scroller.current?.scrollTo({ left: Math.max(0, todayX - dayW * 7), behavior: 'smooth' })}
        >
          Today
        </button>
        {ability.edit ? <span className="muted gantt-help">Drag a bar to move it, or its ends to change the dates.</span> : null}
      </div>

      <div className="gantt" ref={scroller}>
        <div className="gantt-inner" style={{ width: `calc(var(--gantt-label) + ${width}px)` }}>
          <div className="gantt-head">
            <div className="gantt-label gantt-corner">Task</div>
            <div className="gantt-scale" style={{ width }}>
              <div className="gantt-months">
                {months.map((m) => (
                  <div key={m.from} className="gantt-month" style={{ left: m.from * dayW, width: m.count * dayW }}>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="gantt-days">
                {days.map((day, i) => {
                  const wd = weekdayOf(day);
                  const show = zoom === 'weeks' || wd === 0;
                  return (
                    <div
                      key={day}
                      className={`gantt-day${wd >= 5 ? ' is-weekend' : ''}${day === now ? ' is-today' : ''}`}
                      style={{ left: i * dayW, width: dayW }}
                    >
                      {show ? Number(day.slice(8)) : ''}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="gantt-body">
            <div className="gantt-grid" style={{ width }} aria-hidden="true">
              {days.map((day, i) =>
                weekdayOf(day) >= 5 ? <div key={day} className="gantt-weekend" style={{ left: i * dayW, width: dayW }} /> : null,
              )}
              {todayX >= 0 && todayX <= width ? <div className="gantt-today" style={{ left: todayX + dayW / 2 }} /> : null}
            </div>

            {groups.map((group) => {
              const key = group.project?.id ?? 'none';
              const span = projectSpan(group.tasks);
              const tint = group.project?.color ?? 'none';
              return (
                <div key={key} className="gantt-group">
                  <div className="gantt-row gantt-row-project">
                    <div className="gantt-label">
                      <ProjectDot project={group.project} />
                      {group.project ? (
                        <button type="button" className="gantt-project-name" disabled={!ability.edit} onClick={() => actions.editProject(group.project!)}>
                          {group.project.name}
                        </button>
                      ) : (
                        <span className="gantt-project-name">Tasks on their own</span>
                      )}
                      {group.project && group.total > 0 ? (
                        <span className="gantt-count">
                          {group.done}/{group.total}
                        </span>
                      ) : null}
                    </div>
                    <div className="gantt-track" style={{ width, backgroundSize: `${dayW}px 100%` }}>
                      {group.project && span ? (
                        <div
                          className={`gantt-project-bar tint-${tint}`}
                          style={{ left: x(span.start), width: (daysBetween(span.start, span.end) + 1) * dayW }}
                          title={`${group.project.name}: ${formatSpan(span.start, span.end, now)}`}
                        >
                          <span style={{ width: `${group.total ? (group.done / group.total) * 100 : 0}%` }} />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {group.tasks.map((task) => {
                    const own = taskSpan(task);
                    const live = drag?.id === task.id ? dragged(drag) : own;
                    const late = isOverdue(task, now);
                    const barWidth = live ? (daysBetween(live.start, live.end) + 1) * dayW : 0;
                    // A short bar has no room for its name; it goes beside the bar instead.
                    const outside = barWidth < 110;
                    return (
                      <div key={task.id} className={`gantt-row${task.status === 'DONE' ? ' is-done' : ''}`}>
                        <div className="gantt-label gantt-label-task">
                          <TaskCheck task={task} ability={ability} actions={actions} />
                          <button type="button" className="gantt-task-name" onClick={() => actions.open(task)} title={task.title}>
                            {task.title}
                          </button>
                        </div>
                        <div
                          className={`gantt-track${!own && ability.edit ? ' is-placeable' : ''}`}
                          style={{ width, backgroundSize: `${dayW}px 100%` }}
                          onClick={(e) => place(e, task)}
                        >
                          {live ? (
                            <button
                              type="button"
                              className={`gantt-task-bar tint-${tint}${late ? ' is-late' : ''}${drag?.id === task.id ? ' is-dragging' : ''}${ability.edit ? ' is-movable' : ''}`}
                              style={{ left: x(live.start), width: barWidth }}
                              title={`${task.title} · ${formatSpan(live.start, live.end, now)} · ${TASK_STATUS_LABELS[task.status]}`}
                              aria-label={`${task.title}, ${formatSpan(live.start, live.end, now)}`}
                              onPointerDown={(e) => begin(e, task, 'move')}
                              onPointerMove={follow}
                              onPointerUp={() => finish(task)}
                              onPointerCancel={() => setDrag(null)}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Pointer users open it on release; this is the keyboard's way in.
                                if (e.detail === 0) actions.open(task);
                              }}
                            >
                              {ability.edit ? (
                                <span
                                  className="gantt-handle gantt-handle-start"
                                  onPointerDown={(e) => begin(e, task, 'start')}
                                  onPointerMove={follow}
                                  onPointerUp={() => finish(task)}
                                  aria-hidden="true"
                                />
                              ) : null}
                              {outside ? null : <span className="gantt-bar-text">{task.title}</span>}
                              {ability.edit ? (
                                <span
                                  className="gantt-handle gantt-handle-end"
                                  onPointerDown={(e) => begin(e, task, 'end')}
                                  onPointerMove={follow}
                                  onPointerUp={() => finish(task)}
                                  aria-hidden="true"
                                />
                              ) : null}
                            </button>
                          ) : null}
                          {live && outside ? (
                            <span className="gantt-bar-label" style={{ left: x(live.start) + barWidth + 6 }} aria-hidden="true">
                              {task.title}
                            </span>
                          ) : null}
                          {live ? null : (
                            <span className="gantt-undated">{ability.edit ? 'No dates - click a day to place it' : 'No dates yet'}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
