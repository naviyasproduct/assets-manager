import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { OrderListsManager } from '@/components/OrderListsManager';

export const dynamic = 'force-dynamic';

/**
 * The lists an order is written in. Reachable from Purchasing rather than the
 * sidebar: it is a settings screen for the people who write orders, not a
 * place anyone starts their day.
 */
export default async function OrderListsPage() {
  const user = await requirePageAccess('purchasing', 'ASSIGNED');
  const canEdit = can(user.access, 'purchasing', 'EDIT');

  const [units, options, catalogue] = await Promise.all([
    prisma.unit.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    }),
    prisma.orderListOption.findMany({
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { value: 'asc' }],
    }),
    prisma.catalogueItem.findMany({
      orderBy: { name: 'asc' },
      include: {
        descriptions: { select: { text: true }, orderBy: { text: 'asc' } },
        _count: { select: { orderItems: true } },
      },
    }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lists</h1>
          <p>
            Units, the oversea dropdowns and the catalogue - what an order is written in.{' '}
            <Link href="/purchasing">Back to Purchasing</Link>
          </p>
        </div>
      </div>
      <OrderListsManager
        canEdit={canEdit}
        units={units.map((unit) => ({
          id: unit.id,
          name: unit.name,
          sortOrder: unit.sortOrder,
          isActive: unit.isActive,
          lineCount: unit._count.items,
        }))}
        options={options.map((option) => ({
          id: option.id,
          kind: option.kind,
          value: option.value,
          sortOrder: option.sortOrder,
          isActive: option.isActive,
        }))}
        catalogue={catalogue.map((item) => ({
          id: item.id,
          name: item.name,
          descriptions: item.descriptions.map((d) => d.text),
          lineCount: item._count.orderItems,
        }))}
      />
    </>
  );
}
