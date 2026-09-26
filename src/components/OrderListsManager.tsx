'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderListKind } from '@prisma/client';
import { api } from '@/lib/client';
import { Field, Alert, Modal, ConfirmDialog, EmptyState } from '@/components/ui';

/**
 * The small vocabularies an order is written in: the units a line is measured
 * in, the four dropdowns on an oversea order, and the catalogue of things this
 * factory buys.
 *
 * None of it is stock and none of it is money - it is what stops the same bolt
 * being typed four ways across four orders. Kept on one screen because each
 * list is too small to deserve its own.
 */

export type UnitRow = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  lineCount: number;
};

export type OptionRow = {
  id: string;
  kind: OrderListKind;
  value: string;
  sortOrder: number;
  isActive: boolean;
};

export type CatalogueRow = {
  id: string;
  name: string;
  descriptions: string[];
  /** How many order lines were written from it - the measure of what matters. */
  lineCount: number;
};

const KIND_LABELS: Record<OrderListKind, string> = {
  FROM: 'From',
  ATTENTION: 'Attention',
  DELIVERY: 'Delivery',
  PAYMENT: 'Payment',
};

const KIND_HINTS: Record<OrderListKind, string> = {
  FROM: 'The office an oversea order is sent from.',
  ATTENTION: 'Who at the supplier it is addressed to.',
  DELIVERY: 'How it ships - the terms agreed with them.',
  PAYMENT: 'When and how it is paid for.',
};

const KINDS: OrderListKind[] = ['FROM', 'ATTENTION', 'DELIVERY', 'PAYMENT'];

type Tab = 'units' | 'dropdowns' | 'catalogue';

export function OrderListsManager({
  units,
  options,
  catalogue,
  canEdit,
}: {
  units: UnitRow[];
  options: OptionRow[];
  catalogue: CatalogueRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('units');

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Which list">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'units'}
              className={tab === 'units' ? 'is-on' : undefined}
              onClick={() => setTab('units')}
            >
              Units
              <span className="tab-count">{units.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'dropdowns'}
              className={tab === 'dropdowns' ? 'is-on' : undefined}
              onClick={() => setTab('dropdowns')}
            >
              Oversea dropdowns
              <span className="tab-count">{options.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'catalogue'}
              className={tab === 'catalogue' ? 'is-on' : undefined}
              onClick={() => setTab('catalogue')}
            >
              Catalogue
              <span className="tab-count">{catalogue.length}</span>
            </button>
          </div>
        </div>
      </div>

      {tab === 'units' ? (
        <Units rows={units} canEdit={canEdit} refresh={() => router.refresh()} />
      ) : tab === 'dropdowns' ? (
        <Dropdowns rows={options} canEdit={canEdit} refresh={() => router.refresh()} />
      ) : (
        <Catalogue rows={catalogue} canEdit={canEdit} refresh={() => router.refresh()} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

function Units({
  rows,
  canEdit,
  refresh,
}: {
  rows: UnitRow[];
  canEdit: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState<UnitRow | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', sortOrder: '0' });
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<UnitRow | null>(null);
  const [deleteError, setDeleteError] = useState('');

  function start(row: UnitRow | 'new') {
    setForm(
      row === 'new'
        ? { name: '', sortOrder: String(rows.length) }
        : { name: row.name, sortOrder: String(row.sortOrder) },
    );
    setError('');
    setFields({});
    setOpen(row);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const json = { name: form.name, sortOrder: form.sortOrder };
    const result =
      open === 'new'
        ? await api('/api/order-lists/units', { method: 'POST', json })
        : await api(`/api/order-lists/units/${(open as UnitRow).id}`, { method: 'PATCH', json });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    setOpen(null);
    refresh();
  }

  async function toggle(row: UnitRow) {
    await api(`/api/order-lists/units/${row.id}`, {
      method: 'PATCH',
      json: { isActive: !row.isActive },
    });
    refresh();
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');
    const result = await api(`/api/order-lists/units/${deleting.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    setDeleting(null);
    refresh();
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Units</h2>
        {canEdit ? (
          <button type="button" className="btn btn-primary" onClick={() => start('new')}>
            + Unit
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No units yet"
          message="A unit is what a quantity counts - PCS, Kg, set. Without one a line is just a number."
        />
      ) : (
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th className="num">On lines</th>
                <th>Status</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 600 }}>{row.name}</td>
                  <td className="num">{row.lineCount}</td>
                  <td>
                    {row.isActive ? (
                      <span className="pill pill-accent">Offered</span>
                    ) : (
                      <span className="pill pill-neutral">Retired</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => start(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => toggle(row)}
                        >
                          {row.isActive ? 'Retire' : 'Offer again'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            setDeleteError('');
                            setDeleting(row);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <Modal
          title={open === 'new' ? 'New unit' : `Edit ${(open as UnitRow).name}`}
          onClose={() => setOpen(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(null)}>
                Cancel
              </button>
              <button type="submit" form="unit-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <form id="unit-form" onSubmit={submit}>
            {error ? <Alert>{error}</Alert> : null}
            <Field label="Unit" htmlFor="unit-name" error={fields.name} hint="As it prints: PCS, Kg, set.">
              <input
                id="unit-name"
                type="text"
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field
              label="Order in the list"
              htmlFor="unit-sort"
              error={fields.sortOrder}
              hint="Lower comes first. The ones used most belong at the top."
            >
              <input
                id="unit-sort"
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              />
            </Field>
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete"
          busy={busy}
          error={deleteError}
          message={
            deleting.lineCount > 0
              ? `${deleting.name} is on ${deleting.lineCount} order line${deleting.lineCount === 1 ? '' : 's'}, so it will be retired instead of deleted - those lines keep it, and it stops being offered on new ones.`
              : 'Nothing uses it, so it goes for good.'
          }
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The four oversea dropdowns
// ---------------------------------------------------------------------------

function Dropdowns({
  rows,
  canEdit,
  refresh,
}: {
  rows: OptionRow[];
  canEdit: boolean;
  refresh: () => void;
}) {
  const [adding, setAdding] = useState<OrderListKind | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<OptionRow | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!adding) return;
    setBusy(true);
    setError('');
    setFields({});
    const result = await api('/api/order-lists/options', {
      method: 'POST',
      json: { kind: adding, value, sortOrder: rows.filter((r) => r.kind === adding).length },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    setAdding(null);
    setValue('');
    refresh();
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    await api(`/api/order-lists/options/${deleting.id}`, { method: 'DELETE' });
    setBusy(false);
    setDeleting(null);
    refresh();
  }

  return (
    <>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
        Suggestions for the four boxes on an oversea order. An order stores the words it
        was written with, so removing one here never changes an order that used it - it
        only stops being offered.
      </p>

      <div className="supplier-grid">
        {KINDS.map((kind) => {
          const mine = rows.filter((row) => row.kind === kind);
          return (
            <div key={kind} className="card">
              <div className="card-head">
                <h2>{KIND_LABELS[kind]}</h2>
                {canEdit ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setError('');
                      setFields({});
                      setValue('');
                      setAdding(kind);
                    }}
                  >
                    + Add
                  </button>
                ) : null}
              </div>
              <div className="card-body stack" style={{ gap: 6 }}>
                <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                  {KIND_HINTS[kind]}
                </p>
                {mine.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    Nothing on this list yet.
                  </p>
                ) : (
                  mine.map((row) => (
                    <div key={row.id} className="pick-row" style={{ justifyContent: 'space-between' }}>
                      <span>{row.value}</span>
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setDeleting(row)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {adding ? (
        <Modal
          title={`Add to ${KIND_LABELS[adding]}`}
          onClose={() => setAdding(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setAdding(null)}>
                Cancel
              </button>
              <button type="submit" form="option-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Add'}
              </button>
            </>
          }
        >
          <form id="option-form" onSubmit={add}>
            {error ? <Alert>{error}</Alert> : null}
            <Field label={KIND_LABELS[adding]} htmlFor="option-value" error={fields.value}>
              <input
                id="option-value"
                type="text"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Remove "${deleting.value}"?`}
          confirmLabel="Remove"
          busy={busy}
          message="It stops being suggested. Orders already written with it are untouched."
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

function Catalogue({
  rows,
  canEdit,
  refresh,
}: {
  rows: CatalogueRow[];
  canEdit: boolean;
  refresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<CatalogueRow | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', descriptions: '' });
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<CatalogueRow | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) ||
          row.descriptions.some((d) => d.toLowerCase().includes(needle)),
      )
    : rows;

  function start(row: CatalogueRow | 'new') {
    setForm(
      row === 'new'
        ? { name: '', descriptions: '' }
        : { name: row.name, descriptions: row.descriptions.join('\n') },
    );
    setError('');
    setFields({});
    setOpen(row);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const json = {
      name: form.name,
      descriptions: form.descriptions
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
    const result =
      open === 'new'
        ? await api('/api/order-lists/catalogue', { method: 'POST', json })
        : await api(`/api/order-lists/catalogue/${(open as CatalogueRow).id}`, {
            method: 'PATCH',
            json,
          });

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    setOpen(null);
    refresh();
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    await api(`/api/order-lists/catalogue/${deleting.id}`, { method: 'DELETE' });
    setBusy(false);
    setDeleting(null);
    refresh();
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>
          {rows.length} item{rows.length === 1 ? '' : 's'}
        </h2>
        <div className="row">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the catalogue…"
            aria-label="Search the catalogue"
            style={{ maxWidth: 260 }}
          />
          {canEdit ? (
            <button type="button" className="btn btn-primary" onClick={() => start('new')}>
              + Item
            </button>
          ) : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={query ? 'No matches' : 'The catalogue is empty'}
          message={
            query
              ? 'Nothing in the catalogue matches that.'
              : 'Names added here are offered when an order line is written, under the equipment on record.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Descriptions</th>
                <th className="num">On orders</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 600 }}>{row.name}</td>
                  <td>
                    {row.descriptions.length === 0 ? (
                      <span className="muted">-</span>
                    ) : (
                      row.descriptions.join(' · ')
                    )}
                  </td>
                  <td className="num">{row.lineCount}</td>
                  {canEdit ? (
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => start(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeleting(row)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <Modal
          title={open === 'new' ? 'New catalogue item' : `Edit ${(open as CatalogueRow).name}`}
          onClose={() => setOpen(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(null)}>
                Cancel
              </button>
              <button type="submit" form="cat-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <form id="cat-form" onSubmit={submit}>
            {error ? <Alert>{error}</Alert> : null}
            <Field label="Item" htmlFor="cat-name" error={fields.name}>
              <input
                id="cat-name"
                type="text"
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field
              label="Descriptions"
              htmlFor="cat-desc"
              error={fields.descriptions}
              hint="One per line - the sizes or models it comes in. Offered on the line's details."
            >
              <textarea
                id="cat-desc"
                rows={6}
                value={form.descriptions}
                onChange={(e) => setForm({ ...form, descriptions: e.target.value })}
              />
            </Field>
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete"
          busy={busy}
          message={
            deleting.lineCount > 0
              ? `It was used on ${deleting.lineCount} order line${deleting.lineCount === 1 ? '' : 's'}. Those lines keep the name they were written with - they only stop pointing back here.`
              : 'It has never been used on an order.'
          }
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}
