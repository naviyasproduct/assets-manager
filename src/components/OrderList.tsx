'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PurchaseOrderKind, PurchaseOrderStatus } from '@prisma/client';
import { ORDER_STATUS_ORDER, formatDate, formatMoney } from '@/lib/format';
import { ORDER_KIND_LABELS } from '@/lib/order-types';
import { EmptyState } from '@/components/ui';
import { Avatar } from '@/components/EmployeeManager';
import { PhotoThumb } from '@/components/PhotoThumb';
import { OrderStatusPill } from '@/components/ui';

export type OrderSummary = {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  kind: PurchaseOrderKind;
  note: string | null;
  departmentName: string;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  itemCount: number;
  unitCount: number;
  itemNames: string[];
  itemPhotos: Array<{ name: string; url: string }>;
  sheetPhotoUrl: string | null;
  supplierNames: string[];
  assignees: Array<{ id: string; name: string; photoUrl: string | null }>;
  /** What the priced lines came to, or null when none are priced yet. */
  spent: number | null;
  pricedAll: boolean;
  assignedToMe: boolean;
};

const TAB_LABELS: Record<PurchaseOrderStatus, string> = {
  NEW: 'New orders',
  PENDING: 'Pending',
  COMPLETED: 'Completed',
};

/** The date that matters differs per tab, so the column is named for it. */
const DATE_LABELS: Record<PurchaseOrderStatus, string> = {
  NEW: 'Written',
  PENDING: 'Sent out',
  COMPLETED: 'Completed',
};

/** The date behind that column, falling back when a stage was skipped. */
function dateFor(order: OrderSummary): string {
  if (order.status === 'COMPLETED' && order.completedAt) return order.completedAt;
  if (order.status === 'PENDING' && order.sentAt) return order.sentAt;
  return order.createdAt;
}

/** A note can run to several lines; the row has space for one. */
function firstLine(note: string): string {
  const line = note.split('\n').find(Boolean) ?? '';
  return line.length > 70 ? `${line.slice(0, 70)}…` : line;
}

/** Units add up fractionally now, so 27.5 must not print as 27.500000000001. */
function tidyUnits(total: number): string {
  return Number.isInteger(total) ? String(total) : String(Number(total.toFixed(3)));
}

const EMPTY: Record<PurchaseOrderStatus, string> = {
  NEW: 'Orders start here while they are being written up. Send one out and it moves to Pending.',
  PENDING: 'Orders that have been handed over to be bought wait here until they come back.',
  COMPLETED: 'Orders that came back, with what was bought and what it cost.',
};

export function OrderList({
  orders,
  initialTab,
  canCreate,
}: {
  orders: OrderSummary[];
  initialTab: PurchaseOrderStatus;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<PurchaseOrderStatus>(initialTab);
  // The old system kept local and oversea on two screens. One screen with a
  // filter, because they are the same thing bought two ways - and "All" is the
  // view neither of the old screens could give.
  const [kind, setKind] = useState<PurchaseOrderKind | 'ALL'>('ALL');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const out: Record<PurchaseOrderStatus, number> = { NEW: 0, PENDING: 0, COMPLETED: 0 };
    for (const order of orders) {
      if (kind !== 'ALL' && order.kind !== kind) continue;
      out[order.status] += 1;
    }
    return out;
  }, [orders, kind]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (order.status !== tab) return false;
      if (kind !== 'ALL' && order.kind !== kind) return false;
      if (!needle) return true;
      return [
        order.number,
        order.departmentName,
        order.note ?? '',
        ...order.itemNames,
        ...order.supplierNames,
        ...order.assignees.map((a) => a.name),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [orders, tab, kind, query]);

  function pickTab(next: PurchaseOrderStatus) {
    setTab(next);
    // Kept in the URL so Back from an order lands on the same tab.
    router.replace(`/purchasing?tab=${next}`, { scroll: false });
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Order stage">
            {ORDER_STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={tab === status}
                className={tab === status ? 'is-on' : undefined}
                onClick={() => pickTab(status)}
              >
                {TAB_LABELS[status]}
                <span className="tab-count">{counts[status]}</span>
              </button>
            ))}
          </div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as PurchaseOrderKind | 'ALL')}
            aria-label="Local or oversea"
            style={{ maxWidth: 150 }}
          >
            <option value="ALL">Local & oversea</option>
            <option value="LOCAL">Local only</option>
            <option value="OVERSEA">Oversea only</option>
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search number, item, supplier, person…"
            aria-label="Search orders"
            style={{ maxWidth: 320 }}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            title={query ? 'No matches' : `Nothing ${tab === 'NEW' ? 'new' : tab === 'PENDING' ? 'pending' : 'completed'}`}
            message={query ? 'No order in this tab matches that search.' : EMPTY[tab]}
            action={
              canCreate && tab === 'NEW' && !query ? (
                <Link href="/purchasing/new" className="btn btn-primary">
                  + Purchase order
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="grid-table order-table">
              <thead>
                <tr>
                  <th style={{ width: 62 }}>Order</th>
                  <th>Number</th>
                  <th>Department</th>
                  <th>What was ordered</th>
                  <th>Photos</th>
                  <th>Bought from</th>
                  <th>Looking after it</th>
                  <th className="nowrap">{DATE_LABELS[tab]}</th>
                  <th className="num">Spent</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => (
                  <tr
                    key={order.id}
                    className="order-row"
                    // The whole row is the target; the number is still a real
                    // link, so the keyboard and "open in new tab" both work.
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a,button')) return;
                      router.push(`/purchasing/${order.id}`);
                    }}
                  >
                    <td>
                      <PhotoThumb
                        src={order.sheetPhotoUrl}
                        name={`The written order for ${order.number}`}
                      />
                    </td>
                    <td>
                      <Link href={`/purchasing/${order.id}`} className="order-number mono">
                        {order.number}
                      </Link>
                      <div className="order-row-pills">
                        {order.kind === 'OVERSEA' ? (
                          <span className="pill pill-neutral">{ORDER_KIND_LABELS.OVERSEA}</span>
                        ) : null}
                        {order.assignedToMe ? <span className="pill pill-accent">Yours</span> : null}
                      </div>
                      {order.note ? (
                        <div className="cell-sub">{firstLine(order.note)}</div>
                      ) : null}
                    </td>
                    <td>{order.departmentName}</td>
                    <td>
                      <div className="order-row-items">
                        {order.itemNames.join(', ')}
                        {order.itemCount > order.itemNames.length
                          ? ` and ${order.itemCount - order.itemNames.length} more`
                          : ''}
                      </div>
                      <div className="cell-sub">
                        {order.itemCount} line{order.itemCount === 1 ? '' : 's'} ·{' '}
                        {tidyUnits(order.unitCount)} unit{order.unitCount === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td>
                      {order.itemPhotos.length === 0 ? (
                        <span className="muted">-</span>
                      ) : (
                        <div className="order-row-photos">
                          {order.itemPhotos.map((photo) => (
                            <PhotoThumb key={photo.url} src={photo.url} name={photo.name} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {order.supplierNames.length === 0 ? (
                        <span className="muted">-</span>
                      ) : (
                        order.supplierNames.join(', ')
                      )}
                    </td>
                    <td>
                      {order.assignees.length === 0 ? (
                        <span className="muted">Nobody</span>
                      ) : (
                        <div className="avatar-stack">
                          {order.assignees.slice(0, 5).map((person) => (
                            <span key={person.id} title={person.name}>
                              <Avatar name={person.name} photoUrl={person.photoUrl} size="sm" />
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="nowrap">{formatDate(dateFor(order))}</td>
                    <td className="num nowrap">
                      {order.spent === null ? (
                        <span className="muted">-</span>
                      ) : (
                        <>
                          {formatMoney(order.spent)}
                          {order.pricedAll ? null : <div className="cell-sub">so far</div>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
