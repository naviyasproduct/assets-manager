'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Type-ahead picker over a known list, with an escape hatch at the bottom for
 * "the thing I want is not in here yet".
 *
 * Why not a <select>: the lists this drives - categories, departments and
 * locations - are all lists the person filling in the form is allowed to add to,
 * and a select cannot offer that without a second control sitting next to it.
 * Why not a plain <input list=…> datalist: it silently accepts free text, which is how
 * "Printing press", "printing press" and "Print press" ended up being three
 * different categories in the first place. This one only ever hands back an id.
 */

export type ComboboxOption = {
  id: string;
  label: string;
  /** Small right-aligned detail - a code, or which department owns the row. */
  hint?: string;
};

export function Combobox({
  id,
  value,
  options,
  onChange,
  placeholder = 'Search…',
  emptyText = 'No matches.',
  disabled = false,
  createLabel,
  onCreate,
}: {
  id: string;
  value: string;
  options: ComboboxOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Text of the row pinned to the bottom of the list. Omit to hide it. */
  createLabel?: string;
  onCreate?: (typedText: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((option) => option.id === value) ?? null;
  const canCreate = Boolean(createLabel && onCreate);

  /**
   * Typing "n" puts everything starting with N first, then anything else
   * containing it - so the obvious match is under the cursor, without hiding the
   * near-misses that stop someone creating a duplicate of what already exists.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;

    const starts: ComboboxOption[] = [];
    const contains: ComboboxOption[] = [];

    for (const option of options) {
      const label = option.label.toLowerCase();
      const hint = (option.hint ?? '').toLowerCase();

      if (label.startsWith(q) || hint.startsWith(q)) starts.push(option);
      else if (label.includes(q) || hint.includes(q)) contains.push(option);
    }

    return [...starts, ...contains];
  }, [options, query]);

  // The create row sits one past the end of the matches.
  const rowCount = matches.length + (canCreate ? 1 : 0);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  // Pointer-down rather than click: closing on click would fire after the form
  // below had already received the press.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Keeps the highlighted row inside the scrolling list during keyboard use.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(index: number) {
    if (canCreate && index === matches.length) {
      setOpen(false);
      const typed = query.trim();
      setQuery('');
      onCreate?.(typed);
      return;
    }

    const option = matches[index];
    if (!option) return;

    onChange(option.id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (rowCount === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + rowCount) % rowCount);
      return;
    }

    if (event.key === 'Enter') {
      // Without this the Enter that picks a category would also submit the form
      // the picker is sitting in.
      if (open && rowCount > 0) {
        event.preventDefault();
        choose(active);
      }
      return;
    }

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery('');
      }
      return;
    }

    if (event.key === 'Tab' && open) {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div className="combo" ref={containerRef}>
      <input
        id={id}
        ref={inputRef}
        type="text"
        className="combo-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={open && rowCount > 0 ? `${id}-row-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={selected ? selected.label : placeholder}
        // Closed, the field reads as the current choice; open, it is a search
        // box that starts empty so the whole list is there to browse.
        value={open ? query : (selected?.label ?? '')}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onMouseDown={() => setOpen(true)}
        onBlur={() => setQuery('')}
        onKeyDown={onKeyDown}
      />

      <span className="combo-caret" aria-hidden="true">
        ▾
      </span>

      {open ? (
        <ul className="combo-menu" id={`${id}-listbox`} role="listbox" ref={listRef}>
          {matches.map((option, index) => (
            <li
              key={option.id}
              id={`${id}-row-${index}`}
              role="option"
              aria-selected={option.id === value}
              className={`combo-option${index === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // Stops the input blurring before the choice is registered.
                event.preventDefault();
                choose(index);
              }}
            >
              <span className="combo-label">{option.label}</span>
              {option.hint ? <span className="combo-hint mono">{option.hint}</span> : null}
            </li>
          ))}

          {matches.length === 0 && !canCreate ? (
            <li className="combo-empty">{emptyText}</li>
          ) : null}

          {canCreate ? (
            <li
              id={`${id}-row-${matches.length}`}
              role="option"
              aria-selected={false}
              className={`combo-option combo-create${matches.length === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(matches.length)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(matches.length);
              }}
            >
              <span aria-hidden="true">+</span>
              <span>
                {query.trim() ? `${createLabel} “${query.trim()}”` : createLabel}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
