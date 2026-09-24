'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PurchaseOrderStatus } from '@prisma/client';
import { ORDER_STATUS_ORDER, formatDate, formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/ui';
import { Avatar } from '@/components/EmployeeManager';

export type OrderSummary = {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  note: string | null;
  departmentName: string;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
  itemCount: number;
  unitCount: number;
  itemNames: string[];
  itemPhotos: string[];
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
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const out: Record<PurchaseOrderStatus, number> = { NEW: 0, PENDING: 0, COMPLETED: 0 };
    for (const order of orders) out[order.status] += 1;
    return out;
  }, [orders]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (order.status !== tab) return false;
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
  }, [orders, tab, query]);

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
        <div className="order-grid">
          {visible.map((order) => (
            <Link key={order.id} href={`/purchasing/${order.id}`} className="order-card">
              <div className="order-card-head">
                <span className="order-number">{order.number}</span>
                {order.assignedToMe ? <span className="pill pill-accent">Yours</span> : null}
                <span className="muted order-card-date">
                  {order.status === 'COMPLETED' && order.completedAt
                    ? `Completed ${formatDate(order.completedAt)}`
                    : order.status === 'PENDING' && order.sentAt
                      ? `Sent ${formatDate(order.sentAt)}`
                      : `Written ${formatDate(order.createdAt)}`}
                </span>
              </div>

              <div className="order-card-body">
                {order.sheetPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="order-sheet-thumb" src={order.sheetPhotoUrl} alt="" />
                ) : null}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="order-card-dept">{order.departmentName}</div>
                  <div className="order-card-items">
                    {order.itemNames.join(', ')}
                    {order.itemCount > order.itemNames.length
                      ? ` and ${order.itemCount - order.itemNames.length} more`
                      : ''}
                  </div>
                  <div className="cell-sub">
                    {order.itemCount} line{order.itemCount === 1 ? '' : 's'} · {order.unitCount} unit
                    {order.unitCount === 1 ? '' : 's'}
                    {order.supplierNames.length > 0 ? ` · ${order.supplierNames.join(', ')}` : ''}
                  </div>
                </div>
              </div>

              {order.itemPhotos.length > 0 ? (
                <div className="order-card-photos">
                  {order.itemPhotos.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} className="thumb thumb-sm" src={src} alt="" />
                  ))}
                </div>
              ) : null}

              <div className="order-card-foot">
                <div className="avatar-stack">
                  {order.assignees.length === 0 ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      Nobody assigned
                    </span>
                  ) : (
                    order.assignees.slice(0, 5).map((person) => (
                      <span key={person.id} title={person.name}>
                        <Avatar name={person.name} photoUrl={person.photoUrl} size="sm" />
                      </span>
                    ))
                  )}
                </div>
                {order.spent !== null ? (
                  <span className="order-card-spent">
                    {formatMoney(order.spent)}
                    {order.pricedAll ? '' : ' so far'}
                  </span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
