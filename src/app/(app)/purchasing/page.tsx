import Link from 'next/link';
import type { PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { canAccessDepartment } from '@/lib/auth';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { personPhotoUrl } from '@/lib/queries';
import { decimalToNumber } from '@/lib/serialize';
import { visibleOrdersWhere } from '@/lib/purchase-order';
import { OrderList, type OrderSummary } from '@/components/OrderList';

export const dynamic = 'force-dynamic';

const TABS: PurchaseOrderStatus[] = ['NEW', 'PENDING', 'COMPLETED'];

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string; tab?: string }>;
}) {
  const user = await requirePageAccess('purchasing', 'ASSIGNED');
  const { departmentId, tab } = await searchParams;

  // A department filter only narrows what the person may already see.
  const departmentFilter =
    departmentId && canAccessDepartment(user, departmentId) ? { departmentId } : {};

  const orders = await prisma.purchaseOrder.findMany({
    where: { AND: [visibleOrdersWhere(user), departmentFilter] },
    orderBy: [{ updatedAt: 'desc' }],
    select: {
      id: true,
      number: true,
      status: true,
      note: true,
      createdAt: true,
      sentAt: true,
      completedAt: true,
      department: { select: { name: true } },
      suppliers: { select: { supplier: { select: { name: true } } } },
      assignees: {
        select: {
          user: { select: { id: true, name: true, photoRelativePath: true, photoUploadedAt: true } },
        },
      },
      items: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          name: true,
          quantity: true,
          boughtUnitPrice: true,
          photoRelativePath: true,
          photoUploadedAt: true,
          basedOnAsset: { select: { photoRelativePath: true, photoUploadedAt: true } },
        },
      },
      photos: {
        where: { kind: 'SHEET' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true },
      },
    },
  });

  const rows: OrderSummary[] = orders.map((order) => {
    let spent = 0;
    let priced = 0;
    for (const item of order.items) {
      const unit = decimalToNumber(item.boughtUnitPrice);
      if (unit !== null) {
        spent += unit * item.quantity;
        priced += 1;
      }
    }
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      note: order.note,
      departmentName: order.department.name,
      createdAt: order.createdAt.toISOString(),
      sentAt: order.sentAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      itemCount: order.items.length,
      unitCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      itemNames: order.items.slice(0, 4).map((item) => item.name),
      itemPhotos: order.items
        .filter((item) => item.photoRelativePath || item.basedOnAsset?.photoRelativePath)
        .slice(0, 4)
        .map((item) => {
          const stamp = item.photoRelativePath
            ? item.photoUploadedAt?.getTime()
            : `a${item.basedOnAsset?.photoUploadedAt?.getTime() ?? 0}`;
          return `/api/purchase-orders/${order.id}/items/${item.id}/photo?v=${stamp}`;
        }),
      sheetPhotoUrl: order.photos[0]
        ? `/api/purchase-orders/${order.id}/photos/${order.photos[0].id}`
        : null,
      supplierNames: order.suppliers.map((s) => s.supplier.name).sort(),
      assignees: order.assignees.map(({ user: person }) => ({
        id: person.id,
        name: person.name,
        photoUrl: personPhotoUrl(person),
      })),
      spent: priced > 0 ? spent : null,
      pricedAll: priced === order.items.length,
      assignedToMe: order.assignees.some((a) => a.user.id === user.id),
    };
  });

  const canCreate = can(user.access, 'purchasing', 'EDIT');
  const initialTab = TABS.includes(tab as PurchaseOrderStatus)
    ? (tab as PurchaseOrderStatus)
    : 'NEW';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Purchasing</h1>
          <p>
            {can(user.access, 'purchasing', 'VIEW')
              ? 'Every purchase order, from the list somebody wrote to what was bought and what it cost.'
              : 'The orders you have been asked to take care of.'}
          </p>
        </div>
        {canCreate ? (
          <Link href="/purchasing/new" className="btn btn-primary">
            + Purchase order
          </Link>
        ) : null}
      </div>

      <OrderList orders={rows} initialTab={initialTab} canCreate={canCreate} />
    </>
  );
}
