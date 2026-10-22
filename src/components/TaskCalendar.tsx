'use client';

import { useMemo, useRef, useState } from 'react';
import {
  addDays,
  addMonths,
  daysBetween,
  formatMonth,
  formatSpan,
  formatWeekday,
  maxDay,
  minDay,
  startOfMonth,
  startOfWeek,
  type Day,
} from '@/lib/days';
import { isOverdue, taskSpan, type TaskAbility, type TaskRow } from '@/lib/task-types';
import type { TaskActions, TaskGroup } from '@/components/TaskParts';

/**
 * A month of tasks. A task runs as one bar across the days it covers, broken
 * only at the end of a week. With tasks Edit, a bar is dragged to another day
 * (keeping its length) and a click on a day starts a task due then.
 *
 * Bars are laid into lanes per week - the first lane free on every day it
 * covers - so two tasks never sit on top of each other and a week only grows
 * as tall as its busiest day needs.
 */

type Placed = { task: TaskRow; color: string; from: number; to: number; lane: number; cutStart: boolean; cutEnd: boolean };

export function TaskCalendar({
  groups,
  ability,
  actions,
  now,
  undated,
}: {
  groups: TaskGroup[];
  ability: TaskAbility;
  actions: TaskActions;
  now: Day;
  /** Tasks shown in the other views with no dates yet, so not on here. */
  undated: number;
}) {
  const [month, setMonth] = useState<Day>(startOfMonth(now));
  const [over, setOver] = useState<Day | null>(null);
  // Which day of a bar was grabbed, so a three-day task dropped on Friday
  // lands with the grabbed day on Friday, not its start.
  const grab = useRef<{ task: TaskRow; day: Day } | null>(null);

  const weeks = useMemo(() => {
    const first = startOfWeek(month);
    const next = addMonths(month, 1);
    const out: Day[] = [];
    for (let w = first; w < next; w = addDays(w, 7)) out.push(w);
    return out;
  }, [month]);

  const dated = useMemo(
    () =>
      groups.flatMap((g) =>
        g.tasks.flatMap((task) => {
          const span = taskSpan(task);
          return span ? [{ task, span, color: g.project?.color ?? 'none' }] : [];
        }),
      ),
    [groups],
  );

  function placeWeek(weekStart: Day): { bars: Placed[]; lanes: number } {
    const weekEnd = addDays(weekStart, 6);
    const items = dated
      .filter(({ span }) => span.start <= weekEnd && span.end >= weekStart)
      .sort((a, b) => (a.span.start === b.span.start ? daysBetween(b.span.start, b.span.end) - daysBetween(a.span.start, a.span.end) : a.span.start < b.span.start ? -1 : 1));
    const used: boolean[][] = [];
    const bars = items.map(({ task, span, color }) => {
      const from = daysBetween(weekStart, maxDay(span.start, weekStart));
      const to = daysBetween(weekStart, minDay(span.end, weekEnd));
      let lane = 0;
      while ((used[lane] ?? []).slice(from, to + 1).some(Boolean)) lane += 1;
      used[lane] = used[lane] ?? [];
      for (let d = from; d <= to; d++) used[lane][d] = true;
      return { task, color, from, to, lane, cutStart: span.start < weekStart, cutEnd: span.end > weekEnd };
    });
    return { bars, lanes: used.length };
  }

  function dayUnder(event: React.DragEvent, weekStart: Day): Day {
    const row = (event.currentTarget as HTMLElement).closest('.cal-week') as HTMLElement;
    const rect = row.getBoundingClientRect();
    const col = Math.min(6, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * 7)));
    return addDays(weekStart, col);
  }

  function drop(day: Day) {
    const held = grab.current;
    grab.current = null;
    setOver(null);
    if (!held) return;
    const span = taskSpan(held.task);
    if (!span) return;
    const shift = daysBetween(held.day, day);
    if (shift !== 0) actions.move(held.task, addDays(span.start, shift), addDays(span.end, shift));
  }

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-secondary btn-sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            ‹
          </button>
          <button type="button" className="btn btn-secondary btn-sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            ›
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMonth(startOfMonth(now))}>
            Today
          </button>
        </div>
        <h2 className="cal-title">{formatMonth(month)}</h2>
        <span className="muted cal-help">
          {ability.edit ? 'Click a day to add a task; drag one to move it.' : ''}
          {undated > 0 ? ` ${undated} task${undated === 1 ? ' has' : 's have'} no dates and ${undated === 1 ? 'is' : 'are'} not shown.` : ''}
        </span>
      </div>

      <div className="cal-grid">
        <div className="cal-weekdays">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i}>{formatWeekday(addDays(startOfWeek(now), i))}</div>
          ))}
        </div>

        {weeks.map((weekStart) => {
          const { bars, lanes } = placeWeek(weekStart);
          return (
            <div
              key={weekStart}
              className="cal-week"
              style={{ gridTemplateRows: `28px repeat(${lanes}, 24px) 1fr` }}
              // The whole week takes the drop, not each day: a day already
              // carrying a bar must still accept another one.
              onDragOver={(e) => {
                if (!grab.current) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const day = dayUnder(e, weekStart);
                if (over !== day) setOver(day);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(dayUnder(e, weekStart));
              }}
            >
              {Array.from({ length: 7 }, (_, i) => {
                const day = addDays(weekStart, i);
                const inMonth = day.slice(0, 7) === month.slice(0, 7);
                return (
                  <div
                    key={day}
                    className={`cal-day${inMonth ? '' : ' is-other'}${day === now ? ' is-today' : ''}${over === day ? ' is-over' : ''}${i >= 5 ? ' is-weekend' : ''}${ability.edit ? ' is-addable' : ''}`}
                    style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
                    onClick={() => actions.create({ dueDate: day })}
                    aria-label={ability.edit ? `Add a task due ${formatSpan(day, day, now)}` : undefined}
                  >
                    <span className="cal-date">{day.endsWith('-01') ? `${Number(day.slice(8))} ${formatMonth(day).split(' ')[0].slice(0, 3)}` : Number(day.slice(8))}</span>
                  </div>
                );
              })}

              {bars.map((bar) => (
                <button
                  key={bar.task.id}
                  type="button"
                  draggable={ability.edit}
                  className={`cal-task tint-${bar.color}${bar.task.status === 'DONE' ? ' is-done' : ''}${isOverdue(bar.task, now) ? ' is-late' : ''}${bar.cutStart ? ' cut-start' : ''}${bar.cutEnd ? ' cut-end' : ''}`}
                  style={{ gridColumn: `${bar.from + 1} / ${bar.to + 2}`, gridRow: bar.lane + 2 }}
                  title={`${bar.task.title} · ${formatSpan(bar.task.startDate, bar.task.dueDate, now)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.open(bar.task);
                  }}
                  onDragStart={(e) => {
                    grab.current = { task: bar.task, day: dayUnder(e, weekStart) };
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', bar.task.title);
                  }}
                  onDragEnd={() => {
                    grab.current = null;
                    setOver(null);
                  }}
                >
                  {bar.task.status === 'DONE' ? <span aria-hidden="true">✓ </span> : null}
                  {bar.cutStart ? <span aria-hidden="true">‹ </span> : null}
                  {bar.task.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
