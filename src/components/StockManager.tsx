'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { formatMoney } from '@/lib/format';
import { Alert, ConfirmDialog, Field, Modal } from '@/components/ui';

/**
 * The Stock page: how many of each stocked asset are on hand, against the
 * limit someone set for it. Kept to the essentials - a count, a limit, stock
 * in and out - because the count is the asset's own quantity and everything
 * else about the item lives on the asset's page.
 */

export type StockStatus = 'OK' | 'LOW' | 'OUT';

export type StockRow = {
  assetId: string;
  assetTag: string;
  name: string;
  photoUrl: string | null;
  categoryName: string;
  departmentName: string;
  locationName: string | null;
  quantity: number;
  minLevel: number;
  unitCost: number | null;
  status: StockStatus;
};

type Filter = 'ALL' | 'LOW' | 'OUT';

const STATUS_PILL: Record<StockStatus, { label: string; className: string }> = {
  OK: { label: 'In stock', className: 'pill pill-ok' },
  LOW: { label: 'Running low', className: 'pill pill-warn' },
  OUT: { label: 'Out of stock', className: 'pill pill-bad' },
};

type Dialog =
  | { kind: 'IN' | 'OUT'; row: StockRow }
  | { kind: 'EDIT'; row: StockRow }
  | { kind: 'REMOVE'; row: StockRow };

export function StockManager({
  rows,
  canEdit,
  showDepartment,
  mailOn,
}: {
  rows: StockRow[];
  canEdit: boolean;
  showDepartment: boolean;
  mailOn: boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const low = rows.filter((row) => row.status !== 'OK');
  const out = rows.filter((row) => row.status === 'OUT');
  const value = rows.reduce((sum, row) => sum + (row.unitCost ?? 0) * row.quantity, 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'LOW' && row.status === 'OK') return false;
      if (filter === 'OUT' && row.status !== 'OUT') return false;
      if (!q) return true;
      return [row.name, row.assetTag, row.categoryName, row.departmentName, row.locationName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, filter]);

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">Items on stock</div>
          <div className="stat-value">{rows.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Running low</div>
          <div className="stat-value" style={low.length > out.length ? { color: 'var(--warn)' } : undefined}>
            {low.length - out.length}
          </div>
          <div className="stat-note">below their limit</div>
        </div>
        <div className="stat">
          <div className="stat-label">Out of stock</div>
          <div className="stat-value" style={out.length ? { color: 'var(--bad)' } : undefined}>
            {out.length}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Stock value</div>
          <div className="stat-value" style={{ fontSize: 19 }}>
            {formatMoney(value)}
          </div>
          <div className="stat-note">count × unit price</div>
        </div>
      </div>

      {low.length > 0 ? (
        <Alert kind="warn">
          <strong>
            {low.length} item{low.length === 1 ? '' : 's'} need{low.length === 1 ? 's' : ''} refilling:
          </strong>{' '}
          {low
            .map((row) => `${row.name} (${row.quantity}${row.minLevel ? ` of ${row.minLevel}` : ''})`)
            .join(', ')}
          {mailOn ? '' : '. No email is sent - SMTP is not set up on the server.'}
        </Alert>
      ) : null}

      <div className="card">
        <div className="toolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, tag, category…"
            aria-label="Search stock"
          />
          <div className="tabs" role="tablist" aria-label="Stock status">
            {(
              [
                ['ALL', 'All', rows.length],
                ['LOW', 'Needs refill', low.length],
                ['OUT', 'Out', out.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? 'is-on' : undefined}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="tab-count">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: 0 }}>
              Nothing on stock yet. Open an asset and press <strong>Add to stock</strong> to start
              tracking it here.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: 0 }}>Nothing matches.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}></th>
                  <th>Item</th>
                  <th>Category</th>
                  {showDepartment ? <th>Department</th> : null}
                  <th className="num">On hand</th>
                  <th className="num">Limit</th>
                  <th>Status</th>
                  {canEdit ? <th style={{ width: 1 }}></th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.assetId}>
                    <td>
                      {row.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="thumb" src={row.photoUrl} alt="" />
                      ) : (
                        <div className="thumb thumb-empty" aria-hidden="true">
                          {row.name[0]?.toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td>
                      <Link href={`/assets/${row.assetId}`} style={{ fontWeight: 600 }}>
                        {row.name}
                      </Link>
                      <div className="cell-sub">
                        <span className="mono">{row.assetTag}</span>
                        {row.locationName ? ` · ${row.locationName}` : ''}
                      </div>
                    </td>
                    <td>{row.categoryName}</td>
                    {showDepartment ? <td>{row.departmentName}</td> : null}
                    <td className="num" style={{ fontSize: 16, fontWeight: 650 }}>
                      {row.quantity}
                    </td>
                    <td className="num">{row.minLevel || <span className="muted">-</span>}</td>
                    <td>
                      <span className={STATUS_PILL[row.status].className}>{STATUS_PILL[row.status].label}</span>
                    </td>
                    {canEdit ? (
                      <td className="nowrap">
                        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={row.quantity === 0}
                            onClick={() => setDialog({ kind: 'OUT', row })}
                          >
                            − Stock out
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setDialog({ kind: 'IN', row })}
                          >
                            + Stock in
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setDialog({ kind: 'EDIT', row })}
                          >
                            Edit
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
      </div>

      {dialog?.kind === 'IN' || dialog?.kind === 'OUT' ? (
        <MoveDialog kind={dialog.kind} row={dialog.row} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'EDIT' ? (
        <EditDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onRemove={() => setDialog({ kind: 'REMOVE', row: dialog.row })}
        />
      ) : null}
      {dialog?.kind === 'REMOVE' ? (
        <RemoveDialog row={dialog.row} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

/** Stock in or out by an amount. */
function MoveDialog({ kind, row, onClose }: { kind: 'IN' | 'OUT'; row: StockRow; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const n = Number(amount);
  const valid = Number.isInteger(n) && n > 0;
  const after = valid ? (kind === 'IN' ? row.quantity + n : row.quantity - n) : null;

  async function save() {
    setBusy(true);
    setError('');
    const result = await api(`/api/stock/${row.assetId}`, {
      method: 'PATCH',
      json: { change: kind === 'IN' ? n : -n },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.fields?.change ?? result.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Modal
      title={`${kind === 'IN' ? 'Stock in' : 'Stock out'} - ${row.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={busy || !valid || (after !== null && after < 0)}
          >
            {busy ? 'Saving…' : kind === 'IN' ? 'Add to stock' : 'Take from stock'}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <Field
        label={kind === 'IN' ? 'How many came in' : 'How many were taken'}
        htmlFor="stock-amount"
        hint={
          after === null
            ? `${row.quantity} on hand now.`
            : after < 0
              ? `Only ${row.quantity} on hand.`
              : `${row.quantity} on hand now → ${after} after this.`
        }
      >
        <input
          id="stock-amount"
          type="number"
          min="1"
          step="1"
          value={amount}
          autoFocus
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !busy && (after ?? 0) >= 0) void save();
          }}
        />
      </Field>
    </Modal>
  );
}

/** The limit, and the count after a physical check. */
function EditDialog({ row, onClose, onRemove }: { row: StockRow; onClose: () => void; onRemove: () => void }) {
  const router = useRouter();
  const [minLevel, setMinLevel] = useState(String(row.minLevel));
  const [count, setCount] = useState(String(row.quantity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  async function save() {
    setBusy(true);
    setError('');
    setFields({});
    const body: Record<string, number | string> = { minLevel };
    if (Number(count) !== row.quantity) body.count = count;
    const result = await api(`/api/stock/${row.assetId}`, { method: 'PATCH', json: body });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Modal
      title={row.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-danger" onClick={onRemove} disabled={busy} style={{ marginRight: 'auto' }}>
            Remove from stock
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <Field
        label="Limit"
        htmlFor="stock-limit"
        error={fields.minLevel}
        hint="Warn when fewer than this are left. 0 = only when it runs out."
      >
        <input id="stock-limit" type="number" min="0" step="1" value={minLevel} autoFocus onChange={(e) => setMinLevel(e.target.value)} />
      </Field>
      <Field
        label="On hand"
        htmlFor="stock-count"
        error={fields.count}
        hint="Correct this after counting the shelf. It is the asset's quantity too."
      >
        <input id="stock-count" type="number" min="0" step="1" value={count} onChange={(e) => setCount(e.target.value)} />
      </Field>
    </Modal>
  );
}

/**
 * On an asset's page. Adding is one click - the limit is set on the Stock page,
 * where it can be compared with everything else on the shelf.
 */
export function AddToStockButton({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add() {
    setBusy(true);
    setError('');
    const result = await api('/api/stock', { method: 'POST', json: { assetId } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={add} disabled={busy}>
        {busy ? 'Adding…' : '+ Add to stock'}
      </button>
      {error ? <span className="err" style={{ fontSize: 12.5 }}>{error}</span> : null}
    </>
  );
}

function RemoveDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    const result = await api(`/api/stock/${row.assetId}`, { method: 'DELETE' });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <ConfirmDialog
      title={`Remove ${row.name} from stock?`}
      confirmLabel="Remove"
      busy={busy}
      error={error}
      message="It stops being watched here. The asset itself and its quantity are not changed."
      onCancel={onClose}
      onConfirm={remove}
    />
  );
}
