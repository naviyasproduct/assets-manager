'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetStatus } from '@prisma/client';
import { ASSET_STATUS_LABELS } from '@/lib/format';

/**
 * Free-text field that searches the equipment already on record as you type,
 * showing each match with its photo.
 *
 * Unlike {@link Combobox} this hands back **text**, not an id, and the text is
 * the point: an order line is frequently for something nobody owns yet, so the
 * field has to stay writable. The list is a shortcut for the common case - "one
 * more of that" - where typing the name from memory is how "Heidelberg SM52"
 * and "Heidleberg SM 52" end up on two lines of the CEO's report.
 *
 * The photos are what make it usable: department heads know their machines by
 * sight long before they know the tag.
 */

export type AssetPickerOption = {
  id: string;
  assetTag: string;
  name: string;
  categoryName: string;
  status: AssetStatus;
  quantity: number;
  photoUrl: string | null;
};

/**
 * A name typed on an order before, from the catalogue. It has no photo and no
 * tag - it is only a name and the descriptions it has been bought in - so it
 * sits below the equipment matches rather than among them.
 */
export type CatalogueOption = {
  id: string;
  name: string;
  descriptions: string[];
};

/** Enough rows to browse, few enough that the menu is not a second table. */
const MAX_ROWS = 40;

/** The catalogue is the fallback, so it gets the smaller share of the menu. */
const MAX_CATALOGUE_ROWS = 12;

export function AssetPicker({
  id,
  value,
  options,
  catalogue = [],
  onChange,
  placeholder,
  emptyText = 'Nothing on record matches - it will go on the order as something new.',
  disabled = false,
  required = false,
  autoFocus = false,
  invalid = false,
}: {
  id: string;
  value: string;
  options: AssetPickerOption[];
  /** Names bought before that are not equipment on record. */
  catalogue?: CatalogueOption[];
  /**
   * `asset` is null when the person typed rather than picked one; `catalogue`
   * is set instead when they picked a name out of the catalogue.
   */
  onChange: (
    text: string,
    asset: AssetPickerOption | null,
    catalogue?: CatalogueOption | null,
  ) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // -1 means "nothing highlighted", which is the state the field has to start
  // in: Enter must submit the form for someone writing in a new item, and only
  // pick a row once they have arrowed onto one.
  const [active, setActive] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /**
   * Starts-with before contains, over the name, the tag and the category, so the
   * obvious match is at the top without the near-misses disappearing.
   */
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, MAX_ROWS);

    const starts: AssetPickerOption[] = [];
    const contains: AssetPickerOption[] = [];

    for (const option of options) {
      const name = option.name.toLowerCase();
      const tag = option.assetTag.toLowerCase();
      const category = option.categoryName.toLowerCase();

      if (name.startsWith(q) || tag.startsWith(q)) starts.push(option);
      else if (name.includes(q) || tag.includes(q) || category.includes(q)) contains.push(option);
    }

    return [...starts, ...contains].slice(0, MAX_ROWS);
  }, [options, value]);

  const catalogueMatches = useMemo(() => {
    const q = value.trim().toLowerCase();
    // Everything already offered above - no point listing the same name twice.
    const shown = new Set(matches.map((m) => m.name.toLowerCase()));
    const starts: CatalogueOption[] = [];
    const contains: CatalogueOption[] = [];

    for (const entry of catalogue) {
      const name = entry.name.toLowerCase();
      if (shown.has(name)) continue;
      if (!q) {
        starts.push(entry);
      } else if (name.startsWith(q)) {
        starts.push(entry);
      } else if (name.includes(q) || entry.descriptions.some((d) => d.toLowerCase().includes(q))) {
        contains.push(entry);
      }
    }

    return [...starts, ...contains].slice(0, MAX_CATALOGUE_ROWS);
  }, [catalogue, matches, value]);

  /** The menu is one list for the keyboard: equipment first, catalogue after. */
  const rows = useMemo(
    () => [
      ...matches.map((option) => ({ kind: 'asset' as const, option })),
      ...catalogueMatches.map((option) => ({ kind: 'catalogue' as const, option })),
    ],
    [matches, catalogueMatches],
  );

  useEffect(() => {
    setActive(-1);
  }, [value, open]);

  // Pointer-down rather than click: closing on click would fire after the form
  // below had already received the press.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Keeps the highlighted row inside the scrolling list during keyboard use.
  useEffect(() => {
    if (!open || active < 0) return;
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function choose(index: number) {
    const row = rows[index];
    if (!row) return;
    if (row.kind === 'asset') onChange(row.option.name, row.option, null);
    else onChange(row.option.name, null, row.option);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (rows.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => {
        const next = current + step;
        if (next < 0) return rows.length - 1;
        if (next >= rows.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === 'Enter') {
      // Only steals the Enter when a row is actually highlighted; otherwise the
      // form submits, which is what someone typing a new item expects.
      if (open && active >= 0) {
        event.preventDefault();
        choose(active);
      }
      return;
    }

    if (event.key === 'Escape' && open) {
      // preventDefault is what tells the surrounding Modal this Escape is spoken
      // for - see the comment on its key handler.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }

    // Tab leaves the typed text as it stands and moves on.
    if (event.key === 'Tab' && open) setOpen(false);
  }

  return (
    <div className="combo" ref={containerRef}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-row-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        onChange={(event) => {
          onChange(event.target.value, null, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onMouseDown={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open ? (
        <ul className="combo-menu asset-menu" id={`${id}-listbox`} role="listbox" ref={listRef}>
          {rows.map((row, index) => {
            const shared = {
              id: `${id}-row-${index}`,
              role: 'option' as const,
              'aria-selected': index === active,
              className: `asset-option${index === active ? ' active' : ''}`,
              onMouseEnter: () => setActive(index),
              onMouseDown: (event: React.MouseEvent) => {
                // Stops the input blurring before the choice is registered.
                event.preventDefault();
                choose(index);
              },
            };

            if (row.kind === 'catalogue') {
              const entry = row.option;
              return (
                <li key={`c${entry.id}`} {...shared}>
                  <div className="thumb thumb-sm thumb-empty" aria-hidden="true">
                    -
                  </div>
                  <div className="asset-option-text">
                    <div className="asset-option-name">{entry.name}</div>
                    <div className="asset-option-sub">
                      {entry.descriptions.length > 0
                        ? entry.descriptions.slice(0, 3).join(' · ')
                        : 'Bought before'}
                    </div>
                  </div>
                  <span className="combo-hint">Catalogue</span>
                </li>
              );
            }

            const option = row.option;
            return (
              <li key={option.id} {...shared}>
                {option.photoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={option.photoUrl} alt="" className="thumb thumb-sm" loading="lazy" />
                ) : (
                  <div className="thumb thumb-sm thumb-empty" aria-hidden="true">
                    -
                  </div>
                )}

                <div className="asset-option-text">
                  <div className="asset-option-name">{option.name}</div>
                  <div className="asset-option-sub">
                    {option.categoryName} · {ASSET_STATUS_LABELS[option.status]}
                    {option.quantity > 1 ? ` · ${option.quantity} units` : ''}
                  </div>
                </div>

                <span className="combo-hint mono">{option.assetTag}</span>
              </li>
            );
          })}

          {rows.length === 0 ? <li className="combo-empty">{emptyText}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
