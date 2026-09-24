import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-auth';
import { loadOrderDetail, loadOrderFormOptions } from '@/lib/purchase-order';
import { OrderEditor } from '@/components/OrderEditor';
import { pageOrder } from '../order-page';

export const dynamic = 'force-dynamic';

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess('purchasing', 'EDIT');
  const order = await pageOrder(() => loadOrderDetail(id, user));

  // The same rules the API applies, so the form never opens for a save that
  // would be refused.
  if (!order.can.manage || order.status === 'COMPLETED') redirect(`/purchasing/${id}`);

  const options = await loadOrderFormOptions(user, {
    supplierIds: order.suppliers.map((s) => s.id),
    assigneeIds: order.assignees.map((a) => a.id),
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Edit {order.number}</h1>
          <p>{order.departmentName}</p>
        </div>
      </div>
      <OrderEditor options={options} order={order} />
    </>
  );
}
