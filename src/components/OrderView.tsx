'use client';

import { Fragment, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PurchaseOrderStatus } from '@prisma/client';
import { api, uploadImage } from '@/lib/client';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import {
  ORDER_KIND_LABELS,
  SIGN_OFF_ROLES,
  formatQuantity,
  lineTotal,
  type OrderDetail,
  type OrderItem,
  type OrderPerson,
  type OrderPhoto,
} from '@/lib/order-types';
import type {
  AssetCategoryOption,
  DepartmentOption,
  LocationOption,
} from '@/components/AssetManager';
import { Alert, ConfirmDialog, Field, Modal, OrderStatusPill } from '@/components/ui';
import { Avatar } from '@/components/EmployeeManager';
import { SupplierCard } from '@/components/SupplierManager';
import { Lightbox } from '@/components/PhotoThumb';

/**
 * One purchase order: everything on it, and whatever the viewer may do next.
 * The server has already decided what that is (`order.can`) - the buttons here
 * only follow it, and every route checks again.
 */

type PriceDraft = { mode: 'UNIT' | 'TOTAL'; value: string };

function unitFrom(draft: PriceDraft, quantity: number): number | null {
  const n = Number(draft.value);
  if (draft.value.trim() === '' || !Number.isFinite(n)) return null;
  return draft.mode === 'UNIT' ? n : Math.round((n * 100) / quantity) / 100;
}

export type CanCreate = { category: boolean; location: boolean; department: boolean };

export function OrderView({
  order,
  locations,
  categories,
  departments,
  canCreate,
}: {
  order: OrderDetail;
  locations: LocationOption[];
  categories: AssetCategoryOption[];
  departments: DepartmentOption[];
  canCreate: CanCreate;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pricing, setPricing] = useState<null | 'complete' | 'prices'>(null);
  const [converting, setConverting] = useState(false);
  const [photo, setPhoto] = useState<OrderPhoto | null>(null);

  const receivedInput = useRef<HTMLInputElement>(null);

  const sheet = order.photos.filter((p) => p.kind === 'SHEET');
  const received = order.photos.filter((p) => p.kind === 'RECEIVED');
  const suppliersById = new Map(order.suppliers.map((s) => [s.id, s]));
  const waiting = order.items.filter((item) => !item.receivedAssetId);

  const priced = order.items.filter((item) => item.boughtUnitPrice !== null);
  const spent = priced.reduce((sum, item) => sum + (lineTotal(item) ?? 0), 0);

  // Only what was actually filled in. A local order has no terms at all, and
  // most orders name one or two people rather than all four.
  const terms: Array<[string, string]> = (
    [
      ['From', order.originFrom],
      ['Attention', order.attention],
      ['Delivery', order.deliveryTerms],
      ['Payment', order.paymentTerms],
    ] as Array<[string, string | null]>
  ).filter((entry): entry is [string, string] => Boolean(entry[1]));

  const signedOff: Array<[string, OrderPerson]> = SIGN_OFF_ROLES.map(
    (role) => [role.label, order[role.key]] as [string, OrderPerson | null],
  ).filter((entry): entry is [string, OrderPerson] => entry[1] !== null);

  async function move(status: PurchaseOrderStatus) {
    setBusy(true);
    setError('');
    const result = await api(`/api/purchase-orders/${order.id}/status`, {
      method: 'POST',
      json: { status },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function addReceived(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError('');
    const failures: string[] = [];
    for (const file of files) {
      const up = await uploadImage(`/api/purchase-orders/${order.id}/photos?kind=RECEIVED`, file, 'POST');
      if (!up.ok) failures.push(up.error);
    }
    setBusy(false);
    if (failures.length) setError(failures.join(' '));
    router.refresh();
  }

  async function removePhoto(target: OrderPhoto) {
    setBusy(true);
    const result = await api(`/api/purchase-orders/${order.id}/photos/${target.id}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!result.ok) setError(result.error);
    router.refresh();
  }

  async function deleteOrder() {
    setBusy(true);
    const result = await api(`/api/purchase-orders/${order.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setConfirmDelete(false);
      return;
    }
    router.push('/purchasing');
    router.refresh();
  }

  // --- The buttons at the top, by stage ---------------------------------------

  const actions: React.ReactNode[] = [];
  const print = (
    <a key="print" href={`/api/purchase-orders/${order.id}/pdf`} className="btn btn-secondary" target="_blank" rel="noreferrer">
      Print order
    </a>
  );

  if (order.status === 'NEW') {
    if (order.can.manage) {
      actions.push(
        <Link key="edit" href={`/purchasing/${order.id}/edit`} className="btn btn-secondary">
          Edit
        </Link>,
        print,
        <button key="send" type="button" className="btn btn-primary" disabled={busy} onClick={() => move('PENDING')}>
          Send out to buy →
        </button>,
      );
    } else actions.push(print);
  } else if (order.status === 'PENDING') {
    if (order.can.manage) {
      actions.push(
        <Link key="edit" href={`/purchasing/${order.id}/edit`} className="btn btn-secondary">
          Edit
        </Link>,
      );
    }
    actions.push(print);
    if (order.can.work) {
      actions.push(
        <button key="done" type="button" className="btn btn-primary" disabled={busy} onClick={() => setPricing('complete')}>
          Mark completed…
        </button>,
      );
    }
  } else {
    actions.push(print);
    if (order.can.work) {
      actions.push(
        <button key="prices" type="button" className="btn btn-secondary" onClick={() => setPricing('prices')}>
          Edit prices
        </button>,
      );
    }
    if (order.can.work && order.can.makeAssets && waiting.length > 0) {
      actions.push(
        <button key="assets" type="button" className="btn btn-primary" onClick={() => setConverting(true)}>
          Add to assets…
        </button>,
      );
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10, marginBottom: 2 }}>
            <span className="mono muted">{order.number}</span>
            <OrderStatusPill status={order.status} />
            <span className="pill pill-neutral">{ORDER_KIND_LABELS[order.kind]}</span>
          </div>
          <h1>{order.departmentName}</h1>
          <p>
            Written by {order.createdByName} on {formatDate(order.createdAt)}
            {/* A note written over several lines collapses to one here, so the
                line breaks become separators rather than disappearing. */}
            {order.note ? ` · ${order.note.split(/\n+/).filter(Boolean).join(' · ')}` : ''}
          </p>
        </div>
        <div className="row">{actions}</div>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <ol className="order-track">
        <li className="is-done">
          <strong>New</strong>
          <span>{formatDate(order.createdAt)}</span>
        </li>
        <li className={order.status !== 'NEW' ? 'is-done' : undefined}>
          <strong>Pending</strong>
          <span>{order.sentAt ? `Sent ${formatDate(order.sentAt)}` : 'Not sent yet'}</span>
        </li>
        <li className={order.status === 'COMPLETED' ? 'is-done' : undefined}>
          <strong>Completed</strong>
          <span>
            {order.completedAt
              ? `${formatDate(order.completedAt)}${order.completedByName ? ` by ${order.completedByName}` : ''}`
              : 'Not yet'}
          </span>
        </li>
      </ol>

      {terms.length > 0 || signedOff.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            {terms.length > 0 ? (
              <dl className="order-terms">
                {terms.map(([label, value]) => (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </Fragment>
                ))}
              </dl>
            ) : null}
            {signedOff.length > 0 ? (
              <>
                <div className="section-label" style={{ marginTop: terms.length > 0 ? 14 : 0 }}>
                  Signed off by
                </div>
                <div className="order-signoffs">
                  {signedOff.map(([label, person]) => (
                    <div key={label} className="pick-row">
                      <Avatar name={person.name} photoUrl={person.photoUrl} />
                      <div>
                        <div style={{ fontWeight: 650 }}>{person.name}</div>
                        <div className="cell-sub">{label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {sheet.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2>The written order</h2>
          </div>
          <div className="card-body">
            <Gallery photos={sheet} onOpen={setPhoto} />
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>
            {order.items.length} item{order.items.length === 1 ? '' : 's'}
          </h2>
          {priced.length > 0 ? (
            <span className="order-card-spent">
              {formatMoney(spent)}
              {priced.length < order.items.length ? ` for ${priced.length} of ${order.items.length}` : ' in total'}
            </span>
          ) : null}
        </div>
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th style={{ width: 66 }}>Photo</th>
                <th>Item</th>
                <th className="num">Qty</th>
                <th>Category</th>
                <th>Bought from</th>
                <th className="num">Unit price</th>
                <th className="num">Total</th>
                {order.status === 'COMPLETED' ? <th>In assets</th> : null}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.photoUrl ? (
                      <button type="button" className="thumb-btn" onClick={() => setPhoto({ id: item.id, kind: 'RECEIVED', url: item.photoUrl!, uploadedByName: null, createdAt: '' })} aria-label={`Open the photo of ${item.name}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="thumb" src={item.photoUrl} alt="" />
                      </button>
                    ) : (
                      <div className="thumb thumb-empty" aria-hidden="true">
                        {item.name[0]?.toUpperCase()}
                      </div>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{item.name}</span>
                    {item.details ? <div className="cell-sub">{item.details}</div> : null}
                    {item.basedOnAssetTag ? (
                      <div className="cell-sub">Another one of {item.basedOnAssetTag}</div>
                    ) : null}
                    {item.codeNo ? <div className="cell-sub mono">{item.codeNo}</div> : null}
                    {item.receivedDate ? (
                      <div className="cell-sub">Arrived {formatDate(item.receivedDate)}</div>
                    ) : null}
                  </td>
                  <td className="num nowrap">{formatQuantity(item)}</td>
                  <td>{item.categoryName ?? <span className="muted">-</span>}</td>
                  <td>
                    {item.supplierId ? (
                      suppliersById.get(item.supplierId)?.name
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td className="num nowrap">{formatMoney(item.boughtUnitPrice)}</td>
                  <td className="num nowrap">{formatMoney(lineTotal(item))}</td>
                  {order.status === 'COMPLETED' ? (
                    <td className="nowrap">
                      {item.receivedAssetId ? (
                        <Link href={`/assets/${item.receivedAssetId}`} className="mono">
                          {item.receivedAssetTag}
                        </Link>
                      ) : (
                        <span className="muted">Not added</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>Suppliers</h2>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {order.suppliers.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No supplier named on this order.</p>
            ) : (
              order.suppliers.map((supplier) => (
                <SupplierCard key={supplier.id} supplier={supplier} compact />
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Taken care of by</h2>
          </div>
          <div className="card-body stack" style={{ gap: 12 }}>
            {order.assignees.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nobody assigned yet.</p>
            ) : (
              order.assignees.map((person) => (
                <div key={person.id} className="pick-row">
                  <Avatar name={person.name} photoUrl={person.photoUrl} size="lg" />
                  <div>
                    <div style={{ fontWeight: 650, fontSize: 15 }}>{person.name}</div>
                    {person.jobTitle ? <div className="cell-sub">{person.jobTitle}</div> : null}
                    {person.phone ? (
                      <a href={`tel:${person.phone}`} style={{ fontSize: 13 }}>
                        {person.phone}
                      </a>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {order.status !== 'NEW' ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>What was bought</h2>
              <p className="muted" style={{ margin: '3px 0 0', fontSize: 12.5 }}>
                Photos of the items that came back, in their boxes or out of them.
              </p>
            </div>
            {order.can.work ? (
              <>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => receivedInput.current?.click()}>
                  {busy ? 'Uploading…' : '+ Add photos'}
                </button>
                <input
                  ref={receivedInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onChange={(e) => {
                    void addReceived(e.target.files);
                    e.target.value = '';
                  }}
                />
              </>
            ) : null}
          </div>
          <div className="card-body">
            {received.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No photos yet.</p>
            ) : (
              <Gallery
                photos={received}
                onOpen={setPhoto}
                onRemove={order.can.work ? removePhoto : undefined}
              />
            )}
          </div>
        </div>
      ) : null}

      {order.status === 'NEW' && order.can.manage ? (
        <div style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
            Delete this order
          </button>
        </div>
      ) : null}
      {order.status === 'PENDING' && order.can.manage ? (
        <div style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => move('NEW')}>
            ← Back to New orders
          </button>
        </div>
      ) : null}
      {order.status === 'COMPLETED' && order.can.manage ? (
        <div style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => move('PENDING')}>
            Reopen - back to Pending
          </button>
        </div>
      ) : null}

      {photo ? <Lightbox src={photo.url} name={order.number} onClose={() => setPhoto(null)} /> : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={`Delete ${order.number}?`}
          confirmLabel="Delete order"
          busy={busy}
          message="The order, its lines and its photos are removed for good."
          onCancel={() => setConfirmDelete(false)}
          onConfirm={deleteOrder}
        />
      ) : null}

      {pricing ? (
        <PricesDialog
          order={order}
          completing={pricing === 'complete'}
          onClose={() => setPricing(null)}
          onDone={(completed) => {
            setPricing(null);
            router.refresh();
            // Straight on to the assets checklist, which is the natural next
            // step and the one most likely to be forgotten.
            if (completed && order.can.makeAssets) setConverting(true);
          }}
        />
      ) : null}

      {converting ? (
        <ToAssetsDialog
          order={order}
          items={waiting}
          locations={locations}
          categories={categories}
          departments={departments}
          canCreate={canCreate}
          onClose={() => {
            setConverting(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function Gallery({
  photos,
  onOpen,
  onRemove,
}: {
  photos: OrderPhoto[];
  onOpen: (photo: OrderPhoto) => void;
  onRemove?: (photo: OrderPhoto) => void;
}) {
  return (
    <div className="photo-strip">
      {photos.map((photo) => (
        <div key={photo.id} className="photo-strip-item">
          <button type="button" className="photo-strip-open" onClick={() => onOpen(photo)} aria-label="Open photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="" />
          </button>
          {photo.uploadedByName ? (
            <div className="photo-strip-caption">
              {photo.uploadedByName} · {formatDateTime(photo.createdAt)}
            </div>
          ) : null}
          {onRemove ? (
            <button type="button" className="photo-strip-remove" aria-label="Remove this photo" onClick={() => onRemove(photo)}>
              ✕
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * What each line cost. Completing an order goes through here, so the price is
 * asked for at the moment it is known - the receipt is in someone's hand.
 * A price can be left blank and filled in later from "Edit prices".
 */
function PricesDialog({
  order,
  completing,
  onClose,
  onDone,
}: {
  order: OrderDetail;
  completing: boolean;
  onClose: () => void;
  onDone: (completed: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>(() =>
    Object.fromEntries(
      order.items.map((item) => [
        item.id,
        { mode: 'UNIT', value: item.boughtUnitPrice === null ? '' : String(item.boughtUnitPrice) },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const total = order.items.reduce((sum, item) => {
    const unit = unitFrom(drafts[item.id], item.quantity);
    return unit === null ? sum : sum + unit * item.quantity;
  }, 0);

  async function save() {
    setBusy(true);
    setError('');
    const prices = await api(`/api/purchase-orders/${order.id}/bought`, {
      method: 'PATCH',
      json: {
        items: order.items.map((item) => ({
          id: item.id,
          boughtUnitPrice: unitFrom(drafts[item.id], item.quantity),
        })),
      },
    });
    if (!prices.ok) {
      setBusy(false);
      setError(prices.error);
      return;
    }
    if (completing) {
      const moved = await api(`/api/purchase-orders/${order.id}/status`, {
        method: 'POST',
        json: { status: 'COMPLETED' },
      });
      if (!moved.ok) {
        setBusy(false);
        setError(`The prices were saved, but the order was not completed: ${moved.error}`);
        return;
      }
    }
    setBusy(false);
    onDone(completing);
  }

  return (
    <Modal
      wide
      title={completing ? `Complete ${order.number}` : `Prices on ${order.number}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : completing ? 'Mark completed' : 'Save prices'}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        What each line cost. Enter it per unit or for the whole line - whichever the receipt shows.
        Anything left blank can be filled in later.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {order.items.map((item) => {
          const draft = drafts[item.id];
          const unit = unitFrom(draft, item.quantity);
          return (
            <div key={item.id} className="price-row">
              <div style={{ minWidth: 0 }}>
                <strong>{item.name}</strong>
                <div className="cell-sub">× {formatQuantity(item)}</div>
              </div>
              <div className="cost-input">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label={`Price of ${item.name}`}
                  value={draft.value}
                  onChange={(e) =>
                    setDrafts({ ...drafts, [item.id]: { ...draft, value: e.target.value } })
                  }
                />
                <div className="switch" role="radiogroup" aria-label="Price entered as">
                  {(['UNIT', 'TOTAL'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={draft.mode === mode}
                      className={draft.mode === mode ? 'is-on' : undefined}
                      onClick={() => setDrafts({ ...drafts, [item.id]: { ...draft, mode } })}
                    >
                      {mode === 'UNIT' ? 'Each' : 'Line total'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="price-says">
                {unit === null
                  ? '-'
                  : draft.mode === 'UNIT'
                    ? `${formatMoney(Math.round(unit * item.quantity * 100) / 100)} for ${formatQuantity(item)}`
                    : `${formatMoney(unit)} each`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="price-total">
        Total <strong>{formatMoney(total)}</strong>
      </div>
    </Modal>
  );
}

/** The sentinel a dropdown uses to mean "none of these - make one". */
const MAKE_NEW = '__new__';

type MakePanel = {
  kind: 'category' | 'location' | 'department';
  name: string;
  code: string;
  /** Which line asked for it; '' for the department, which is dialog-wide. */
  forItem: string;
};

/** First letters of the name - the same suggestion the asset form makes. */
function suggestCode(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
}

/**
 * The little "make one now" form that drops in under a dropdown, so nobody has
 * to abandon a half-ticked dialog to go and create a category.
 */
function MakeInline({
  title,
  panel,
  busy,
  withCode,
  onChange,
  onCancel,
  onSave,
}: {
  title: string;
  panel: MakePanel;
  busy: boolean;
  /** The hint under the code field, or null when this kind has no code. */
  withCode: string | null;
  onChange: (panel: MakePanel) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="inline-panel">
      <div className="inline-panel-head">{title}</div>
      <div className="field-row">
        <Field label="Name" htmlFor="make-name">
          <input
            id="make-name"
            type="text"
            autoFocus
            value={panel.name}
            onChange={(e) =>
              onChange({
                ...panel,
                name: e.target.value,
                // The code follows the name until someone types their own.
                code:
                  panel.code === suggestCode(panel.name)
                    ? suggestCode(e.target.value)
                    : panel.code,
              })
            }
          />
        </Field>
        {withCode ? (
          <Field label="Code" htmlFor="make-code" hint={withCode}>
            <input
              id="make-code"
              type="text"
              value={panel.code}
              onChange={(e) => onChange({ ...panel, code: e.target.value.toUpperCase() })}
            />
          </Field>
        ) : null}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onSave}
          disabled={busy || panel.name.trim() === '' || (withCode !== null && panel.code.trim() === '')}
        >
          {busy ? 'Saving…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

/** Ticking which of the arrived lines go into the assets list, and how. */
function ToAssetsDialog({
  order,
  items,
  locations,
  categories,
  departments,
  canCreate,
  onClose,
}: {
  order: OrderDetail;
  items: OrderItem[];
  locations: LocationOption[];
  categories: AssetCategoryOption[];
  departments: DepartmentOption[];
  canCreate: CanCreate;
  onClose: () => void;
}) {
  type Pick = {
    on: boolean;
    mode: 'NEW' | 'ADD_TO_EXISTING';
    categoryId: string;
    locationId: string;
  };
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        {
          // Ticked when it can go in as it stands. A line with no category and
          // nothing to top up is usually a consumable, not equipment.
          // Ticked by default now that a category can be chosen here: a line
          // without one is no longer a dead end.
          on: true,
          mode: item.basedOnAssetId ? 'ADD_TO_EXISTING' : 'NEW',
          categoryId: item.categoryId ?? '',
          locationId: '',
        },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Array<{ assetId: string; assetTag: string }> | null>(null);

  // Which department the new assets are filed under. Categories belong to a
  // department, so this is one choice for the whole dialog rather than per
  // line - otherwise every row would offer a different category list.
  const [departmentId, setDepartmentId] = useState(
    departments.some((d) => d.id === order.departmentId)
      ? order.departmentId
      : (departments[0]?.id ?? order.departmentId),
  );

  // Things made from inside the dialog are usable before the page reloads.
  const [addedCategories, setAddedCategories] = useState<AssetCategoryOption[]>([]);
  const [addedLocations, setAddedLocations] = useState<LocationOption[]>([]);
  const [addedDepartments, setAddedDepartments] = useState<DepartmentOption[]>([]);
  const [making, setMaking] = useState<MakePanel | null>(null);

  const allCategories = [...categories, ...addedCategories];
  const allLocations = [...locations, ...addedLocations];
  const allDepartments = [...departments, ...addedDepartments];

  const chosen = items.filter((item) => picks[item.id].on);
  const blockedCount = chosen.filter(
    (item) =>
      (picks[item.id].mode === 'NEW' && !picks[item.id].categoryId) ||
      !Number.isInteger(item.quantity),
  ).length;

  /** A category made here belongs to the department the dialog is filing under. */
  async function make(panel: MakePanel): Promise<void> {
    setBusy(true);
    setError('');
    if (panel.kind === 'category') {
      const result = await api<{ category: AssetCategoryOption }>('/api/asset-categories', {
        method: 'POST',
        json: { name: panel.name, code: panel.code, departmentId },
      });
      setBusy(false);
      if (!result.ok) return setError(result.fields?.name ?? result.fields?.code ?? result.error);
      setAddedCategories((current) => [...current, result.data.category]);
      setPicks((current) => ({
        ...current,
        [panel.forItem]: { ...current[panel.forItem], categoryId: result.data.category.id },
      }));
    } else if (panel.kind === 'location') {
      const result = await api<{ location: LocationOption }>('/api/locations', {
        method: 'POST',
        json: { name: panel.name },
      });
      setBusy(false);
      if (!result.ok) return setError(result.fields?.name ?? result.error);
      setAddedLocations((current) => [...current, result.data.location]);
      setPicks((current) => ({
        ...current,
        [panel.forItem]: { ...current[panel.forItem], locationId: result.data.location.id },
      }));
    } else {
      const result = await api<{ department: DepartmentOption }>('/api/departments', {
        method: 'POST',
        json: { name: panel.name, code: panel.code },
      });
      setBusy(false);
      if (!result.ok) return setError(result.fields?.name ?? result.fields?.code ?? result.error);
      setAddedDepartments((current) => [...current, result.data.department]);
      setDepartmentId(result.data.department.id);
      // Categories belong to a department, so the old picks cannot follow.
      setPicks((current) =>
        Object.fromEntries(
          Object.entries(current).map(([id, pick]) => [id, { ...pick, categoryId: '' }]),
        ),
      );
    }
    setMaking(null);
  }

  async function save() {
    setBusy(true);
    setError('');
    const result = await api<{ assets: Array<{ assetId: string; assetTag: string }> }>(
      `/api/purchase-orders/${order.id}/to-assets`,
      {
        method: 'POST',
        json: {
          departmentId,
          items: chosen.map((item) => ({
            id: item.id,
            mode: picks[item.id].mode,
            categoryId: picks[item.id].categoryId || null,
            locationId: picks[item.id].locationId || null,
          })),
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(result.data.assets);
  }

  const activeLocations = allLocations.filter((location) => location.isActive);
  const departmentCategories = allCategories.filter(
    (category) => category.departmentId === departmentId && category.isActive,
  );

  return (
    <Modal
      wide
      title={done ? 'Added to the assets' : 'Add what arrived to the assets'}
      onClose={onClose}
      footer={
        done ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Not now
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || chosen.length === 0 || blockedCount > 0}>
              {busy ? 'Adding…' : `Add ${chosen.length} to assets`}
            </button>
          </>
        )
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      {done ? (
        <p style={{ marginTop: 0 }}>
          {done.length} line{done.length === 1 ? '' : 's'} went in:{' '}
          {done.map((asset, index) => (
            <span key={asset.assetId}>
              {index > 0 ? ', ' : ''}
              <Link href={`/assets/${asset.assetId}`} className="mono">
                {asset.assetTag}
              </Link>
            </span>
          ))}
          . The price bought at is their unit cost, and the photo came across with them.
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Untick anything that is not equipment - paper, oil, spare screws. It can be added later
            from this order.
          </p>

          <div className="convert-dept">
            <label htmlFor="convert-dept">Filed under</label>
            <select
              id="convert-dept"
              value={departmentId}
              onChange={(e) => {
                if (e.target.value === MAKE_NEW) {
                  setMaking({ kind: 'department', name: '', code: '', forItem: '' });
                  return;
                }
                setDepartmentId(e.target.value);
                // Categories belong to a department, so they cannot come along.
                setPicks((current) =>
                  Object.fromEntries(
                    Object.entries(current).map(([id, pick]) => [id, { ...pick, categoryId: '' }]),
                  ),
                );
              }}
            >
              {allDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
              {canCreate.department ? <option value={MAKE_NEW}>+ New department…</option> : null}
            </select>
            <span className="muted" style={{ fontSize: 12.5 }}>
              Where the new assets live, and whose categories are offered below.
            </span>
          </div>

          {making && making.kind === 'department' ? (
            <MakeInline
              title="New department"
              panel={making}
              busy={busy}
              withCode="The start of every tag here, e.g. WRK."
              onChange={setMaking}
              onCancel={() => setMaking(null)}
              onSave={() => make(making)}
            />
          ) : null}

          <div className="stack" style={{ gap: 8 }}>
            {items.map((item) => {
              const pick = picks[item.id];
              const set = (patch: Partial<Pick>) =>
                setPicks({ ...picks, [item.id]: { ...pick, ...patch } });
              // Assets are counted one by one, so a line measured out in Kg
              // has no whole thing to become. The API refuses it too.
              const measured = !Number.isInteger(item.quantity);
              const blocked = (pick.mode === 'NEW' && !pick.categoryId) || measured;
              return (
                <div key={item.id} className={`convert-row${pick.on ? '' : ' is-off'}`}>
                  <label className="checkbox">
                    <input type="checkbox" checked={pick.on} onChange={(e) => set({ on: e.target.checked })} />
                    <span>
                      <strong>{item.name}</strong> × {formatQuantity(item)}
                      <span className="cell-sub" style={{ display: 'block' }}>
                        {item.categoryName ?? 'No category'}
                        {item.boughtUnitPrice !== null ? ` · ${formatMoney(item.boughtUnitPrice)} each` : ' · no price yet'}
                      </span>
                    </span>
                  </label>
                  {item.basedOnAssetId ? (
                    <select value={pick.mode} onChange={(e) => set({ mode: e.target.value as Pick['mode'] })} disabled={!pick.on}>
                      <option value="ADD_TO_EXISTING">Add {item.quantity} to {item.basedOnAssetTag}</option>
                      <option value="NEW">As a new asset</option>
                    </select>
                  ) : (
                    <span className="muted" style={{ fontSize: 12.5 }}>As a new asset</span>
                  )}
                  {pick.mode === 'NEW' ? (
                    <select
                      value={pick.categoryId}
                      onChange={(e) => {
                        if (e.target.value === MAKE_NEW) {
                          // Both prefilled from the line, so the code follows
                          // the name the way it does on the asset form.
                          setMaking({
                            kind: 'category',
                            name: item.name,
                            code: suggestCode(item.name),
                            forItem: item.id,
                          });
                          return;
                        }
                        set({ categoryId: e.target.value });
                      }}
                      disabled={!pick.on}
                      aria-label={`What kind of thing ${item.name} is`}
                    >
                      <option value="">Pick a category</option>
                      {departmentCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                      {canCreate.category ? <option value={MAKE_NEW}>+ New category…</option> : null}
                    </select>
                  ) : (
                    <span />
                  )}
                  {pick.mode === 'NEW' ? (
                    <select
                      value={pick.locationId}
                      onChange={(e) => {
                        if (e.target.value === MAKE_NEW) {
                          setMaking({ kind: 'location', name: '', code: '', forItem: item.id });
                          return;
                        }
                        set({ locationId: e.target.value });
                      }}
                      disabled={!pick.on}
                      aria-label="Where it will stand"
                    >
                      <option value="">No location yet</option>
                      {activeLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                      {canCreate.location ? <option value={MAKE_NEW}>+ New location…</option> : null}
                    </select>
                  ) : (
                    <span />
                  )}
                  {making && making.forItem === item.id ? (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <MakeInline
                        title={making.kind === 'category' ? 'New category' : 'New location'}
                        panel={making}
                        busy={busy}
                        withCode={
                          making.kind === 'category'
                            ? 'The middle of the asset tag, e.g. CHR.'
                            : null
                        }
                        onChange={setMaking}
                        onCancel={() => setMaking(null)}
                        onSave={() => make(making)}
                      />
                    </div>
                  ) : null}
                  {pick.on && blocked ? (
                    <div className="err" style={{ gridColumn: '1 / -1', fontSize: 12 }}>
                      {measured
                        ? `This line is ${formatQuantity(item)}, not a whole number of things, so it cannot become an asset. Untick it.`
                        : 'Pick a category for it, or untick it.'}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
