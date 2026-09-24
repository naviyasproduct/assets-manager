import Link from 'next/link';
import { requirePageAccess } from '@/lib/page-auth';
import { loadOrderDetail } from '@/lib/purchase-order';
import { loadLocationOptions } from '@/lib/queries';
import { OrderView } from '@/components/OrderView';
import { pageOrder } from './order-page';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess('purchasing', 'ASSIGNED');
  const order = await pageOrder(() => loadOrderDetail(id, user));
  // Only needed to place new assets, so only loaded for someone who may make them.
  const locations = order.can.makeAssets ? await loadLocationOptions() : [];

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={`/purchasing?tab=${order.status}`} className="muted" style={{ fontSize: 13 }}>
          ← Purchasing
        </Link>
      </div>
      <OrderView order={order} locations={locations} />
    </>
  );
}
