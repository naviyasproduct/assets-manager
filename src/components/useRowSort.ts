'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Dragging a table row into a new place, the way a sortable list on a phone
 * works: the row lifts and follows the pointer, the others slide apart to show
 * where it will land, and letting go puts it exactly there.
 *
 * Pointer events rather than the browser's drag-and-drop. That one cannot
 * show the gap opening, and a release anywhere it does not accept - the row's
 * own spot, the gap between two rows - flies the ghost back to where it
 * started, which reads as the row refusing to move.
 *
 * A row is picked up from anywhere on it that is not a control (link, button,
 * tick box), not only by its grip: people reach for the name. It only lifts
 * once the pointer has moved a few pixels up or down, so a click is still a
 * click and dragging sideways still selects text. The moves and the release
 * are heard on the window, not on the row, so nothing the page does to the
 * row while it is held - a re-render, a reorder - can strand the drag.
 *
 * Rows take part when they carry `data-sort-id` and the same
 * `data-sort-group` as the dragged one (a department, for the assets), so a
 * row can never be dragged out of its own set. Rows in between that carry
 * `data-sort-spacer` - a batch label - keep their place in the sequence and
 * slide with it, so rows of different heights never end up over a label.
 */

type Slot = { id: string; top: number; height: number };

/** Everything from the set's first row to its last, sortable or not, top to bottom. */
type FlowItem = Slot & { spacer: boolean };

type Drag = {
  id: string;
  group: string;
  /** The held row, and where it sat in the page's layout when last measured. */
  el: HTMLElement;
  layoutTop: number;
  from: number;
  slots: Slot[];
  flow: FlowItem[];
  /** The pointer's distance from the top of the table body when it went down. */
  grabY: number;
  startX: number;
  startY: number;
  body: HTMLElement;
  /** False until the pointer has moved far enough to mean a drag. */
  lifted: boolean;
};

/** Where the held row would land: between `above` and `below`, nearer one of them. */
export type SortSpot = {
  above: string | null;
  below: string | null;
  /** Which neighbour the row is leaning into - what decides joining a group at its edge. */
  nearer: 'above' | 'below';
};

export type SortView = SortSpot & {
  id: string;
  /** How far the dragged row has moved from its own place. */
  dy: number;
  /** How far every other row is shifted to open the gap. */
  offsets: Map<string, number>;
};

export type SortDrop = SortSpot & {
  movedId: string;
  targetId: string;
  side: 'before' | 'after';
};

/** Pixels from the window's edge where the page starts to scroll. */
const EDGE = 70;
/** How far the pointer must travel, up or down, before a press becomes a drag. */
const THRESHOLD = 6;
/** Pressing on any of these does what they do, never a drag. */
const CONTROLS = 'a, button:not(.row-grip), input, select, textarea, label, [role="button"]';

export function useRowSort(onDrop: (drop: SortDrop) => void) {
  const drag = useRef<Drag | null>(null);
  const pointerY = useRef(0);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  // The very functions put on the window for this drag, so they are the ones
  // taken off again - this render's would be different functions.
  const attached = useRef<{ move: (e: PointerEvent) => void; up: () => void; cancel: () => void } | null>(null);
  const [view, setView] = useState<SortView | null>(null);

  /**
   * The set as it is laid out now: every row of the group and every spacer
   * between them, without any shift a drag has put on them.
   */
  function layout(body: HTMLElement, group: string) {
    const top = body.getBoundingClientRect().top;
    const all = [...body.querySelectorAll<HTMLElement>('tr')];
    const mine = (tr: HTMLElement) => tr.dataset.sortId !== undefined && tr.dataset.sortGroup === group;
    const first = all.findIndex(mine);
    const last = all.length - 1 - [...all].reverse().findIndex(mine);
    const flow: FlowItem[] = [];
    if (first < 0) return { flow, slots: flow };
    for (const tr of all.slice(first, last + 1)) {
      if (!mine(tr) && tr.dataset.sortSpacer === undefined) continue;
      const rect = tr.getBoundingClientRect();
      const shift = new DOMMatrixReadOnly(getComputedStyle(tr).transform).m42 || 0;
      flow.push({
        id: mine(tr) ? tr.dataset.sortId! : tr.dataset.sortSpacer!,
        top: rect.top - shift - top,
        height: rect.height,
        spacer: !mine(tr),
      });
    }
    return { flow, slots: flow.filter((item) => !item.spacer) };
  }

  /** Where the dragged row is now and which place it would take. */
  function measure() {
    const d = drag.current;
    if (!d) return null;
    // Something moved the rows under the held one - a photo finishing
    // loading, a column re-flowing. Measure again and keep the row under
    // the pointer rather than letting it drift off.
    if (d.el.offsetTop !== d.layoutTop) {
      const fresh = layout(d.body, d.group);
      const from = fresh.slots.findIndex((slot) => slot.id === d.id);
      if (from >= 0) {
        d.grabY += fresh.slots[from].top - d.slots[d.from].top;
        d.flow = fresh.flow;
        d.slots = fresh.slots;
        d.from = from;
      }
      d.layoutTop = d.el.offsetTop;
    }
    const own = d.slots[d.from];
    const first = d.slots[0];
    const last = d.slots[d.slots.length - 1];
    const raw = pointerY.current - d.body.getBoundingClientRect().top - d.grabY;
    // Kept within its own set: from the first row's top to the last row's bottom.
    const dy = Math.min(Math.max(raw, first.top - own.top), last.top + last.height - own.top - own.height);
    const centre = own.top + dy + own.height / 2;
    const others = d.slots.filter((_, i) => i !== d.from);
    const to = others.filter((s) => s.top + s.height / 2 < centre).length;

    // Lay the set out again in the new order: rows stacked by their own
    // heights, labels keeping their place in the sequence.
    const order = [...others];
    order.splice(to, 0, own);
    const offsets = new Map<string, number>();
    let cursor = d.flow[0].top;
    let next = 0;
    let restingTop = own.top;
    for (const item of d.flow) {
      if (item.spacer) {
        offsets.set(item.id, cursor - item.top);
        cursor += item.height;
        continue;
      }
      const row = order[next++];
      if (row.id === own.id) restingTop = cursor;
      else offsets.set(row.id, cursor - row.top);
      cursor += row.height;
    }

    const spot: SortSpot = {
      above: others[to - 1]?.id ?? null,
      below: others[to]?.id ?? null,
      // Which neighbour it leans into, against where it would come to rest.
      nearer: centre < restingTop + own.height / 2 ? 'above' : 'below',
    };
    return { dy, to, others, offsets, spot };
  }

  function show() {
    const d = drag.current;
    const at = measure();
    if (!d || !at) return;
    setView({ id: d.id, dy: at.dy, offsets: at.offsets, ...at.spot });
  }

  function stop() {
    drag.current = null;
    setView(null);
    document.body.classList.remove('is-row-sorting');
    const on = attached.current;
    attached.current = null;
    if (on) {
      window.removeEventListener('pointermove', on.move);
      window.removeEventListener('pointerup', on.up);
      window.removeEventListener('pointercancel', on.cancel);
      window.removeEventListener('blur', on.cancel);
    }
  }

  function onMove(event: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    pointerY.current = event.clientY;
    if (!d.lifted) {
      const down = Math.abs(event.clientY - d.startY);
      // Mostly sideways is someone selecting text, not moving the row.
      if (Math.abs(event.clientX - d.startX) > down && Math.abs(event.clientX - d.startX) > THRESHOLD) {
        stop();
        return;
      }
      if (down < THRESHOLD) return;
      d.lifted = true;
      window.getSelection()?.removeAllRanges();
      document.body.classList.add('is-row-sorting');
    }
    event.preventDefault();
    show();
  }

  function onUp() {
    const d = drag.current;
    const at = d?.lifted ? measure() : null;
    stop();
    if (!d || !at || at.to === d.from) return;
    const target = at.to < at.others.length ? { id: at.others[at.to].id, side: 'before' as const } : { id: at.others[at.others.length - 1].id, side: 'after' as const };
    dropRef.current({ movedId: d.id, targetId: target.id, side: target.side, ...at.spot });
  }

  // While a row is held: scroll the page near its edges, and Escape puts it back.
  useEffect(() => {
    if (!view) return;
    let frame = 0;
    const tick = () => {
      const y = pointerY.current;
      const step = y < EDGE ? -Math.ceil((EDGE - y) / 5) : y > window.innerHeight - EDGE ? Math.ceil((y - window.innerHeight + EDGE) / 5) : 0;
      if (step !== 0) {
        window.scrollBy(0, step);
        show();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        stop();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
    };
    // Only whether a drag is on matters here; show() reads the live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view !== null]);

  // Leaving the page mid-drag leaves nothing listening behind.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), []);

  /** Spread onto each sortable row. */
  function row(id: string, group: string) {
    return {
      onPointerDown(event: React.PointerEvent<HTMLElement>) {
        if (event.button !== 0 || drag.current) return;
        if ((event.target as HTMLElement).closest(CONTROLS)) return;
        const body = event.currentTarget.closest('tbody');
        if (!body) return;
        const top = body.getBoundingClientRect().top;
        const { flow, slots } = layout(body, group);
        const from = slots.findIndex((slot) => slot.id === id);
        if (from < 0 || slots.length < 2) return;
        // The grip is only ever a handle, so it lifts at once; elsewhere the
        // press waits to see whether it is a drag at all.
        const onGrip = !!(event.target as HTMLElement).closest('.row-grip');
        if (onGrip) event.preventDefault();
        pointerY.current = event.clientY;
        drag.current = {
          id,
          group,
          el: event.currentTarget,
          layoutTop: event.currentTarget.offsetTop,
          from,
          slots,
          flow,
          grabY: event.clientY - top,
          startX: event.clientX,
          startY: event.clientY,
          body,
          lifted: onGrip,
        };
        const on = { move: onMove, up: onUp, cancel: stop };
        attached.current = on;
        window.addEventListener('pointermove', on.move);
        window.addEventListener('pointerup', on.up);
        window.addEventListener('pointercancel', on.cancel);
        window.addEventListener('blur', on.cancel);
        if (onGrip) {
          document.body.classList.add('is-row-sorting');
          show();
        }
      },
    };
  }

  return { view, row };
}
