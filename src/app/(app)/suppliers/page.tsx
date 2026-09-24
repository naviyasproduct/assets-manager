import { prisma } from '@/lib/db';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { toSupplierRow } from '@/lib/queries';
import { SupplierManager } from '@/components/SupplierManager';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const user = await requirePageAccess('suppliers', 'VIEW');

  const suppliers = await prisma.supplier.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { orders: true } } },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Suppliers</h1>
          <p>
            The shops and firms orders are bought from. Saved once, their address and numbers go
            out on every order that names them.
          </p>
        </div>
      </div>

      <SupplierManager
        suppliers={suppliers.map((supplier) => ({
          ...toSupplierRow(supplier),
          isActive: supplier.isActive,
          orderCount: supplier._count.orders,
        }))}
        canEdit={can(user.access, 'suppliers', 'EDIT')}
      />
    </>
  );
}
