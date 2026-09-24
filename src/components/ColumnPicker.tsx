'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PickableColumn = { key: string; label: string };

/**
 * Which columns of a screen's table are hidden, remembered per browser.
 *
 * localStorage rather than the database: this is how one person likes to read
 * a table on one PC, not a fact about the data, and it must never be able to
 * break the page - a blocked or cleared storage just means everything shows.
 * The first render always shows every column so the server and the browser
 * agree; the saved choice is applied straight after.
 */
export function useHiddenColumns(storageKey: string, defaultHidden: string[] = []) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(defaultHidden));

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setHidden(new Set(JSON.parse(saved) as string[]));
    } catch {
      // Unreadable storage: keep the defaults.
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: Set<string>) => {
      setHidden(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Not saved, but still applied for this visit.
      }
    },
    [storageKey],
  );

  const toggle = useCallback(
    (key: string) => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next);
    },
    [hidden, persist],
  );

  const showAll = useCallback(() => persist(new Set()), [persist]);

  return { hidden, shown: (key: string) => !hidden.has(key), toggle, showAll };
}

/** The "Columns" button over a table and the tick list it opens. */
export function ColumnPicker({
  columns,
  hidden,
  onToggle,
  onShowAll,
}: {
  columns: PickableColumn[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hiddenCount = columns.filter((column) => hidden.has(column.key)).length;

  return (
    <div className="colpick" ref={rootRef}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Columns{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}
      </button>

      {open ? (
        <div className="colpick-menu" role="group" aria-label="Columns shown in the table">
          {columns.map((column) => (
            <label key={column.key} className="colpick-row">
              <input
                type="checkbox"
                checked={!hidden.has(column.key)}
                onChange={() => onToggle(column.key)}
              />
              {column.label}
            </label>
          ))}
          {hiddenCount > 0 ? (
            <button type="button" className="btn btn-ghost btn-sm colpick-all" onClick={onShowAll}>
              Show all columns
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
