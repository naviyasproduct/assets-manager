import Link from 'next/link';
import { requirePageAccess } from '@/lib/page-auth';
import { loadOrderFormOptions } from '@/lib/purchase-order';
import { OrderEditor } from '@/components/OrderEditor';

export const dynamic = 'force-dynamic';

export default async function NewOrderPage() {
  const user = await requirePageAccess('purchasing', 'EDIT');
  const options = await loadOrderFormOptions(user);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New purchase order</h1>
          <p>
            Write up the whole list: what is needed, how many, where it is bought from and who is
            taking care of it. It starts in <strong>New orders</strong> until it is sent out.
          </p>
        </div>
        <Link href="/purchasing" className="btn btn-secondary">
          Back to Purchasing
        </Link>
      </div>

      {options.departments.length === 0 ? (
        <div className="card card-body">You have no department to order for.</div>
      ) : (
        <OrderEditor options={options} order={null} />
      )}
    </>
  );
}
