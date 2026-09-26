import Link from 'next/link';
import { requirePageAccess } from '@/lib/page-auth';
import { loadOrderDetail } from '@/lib/purchase-order';
import {
  loadAssetCategoryOptions,
  loadDepartmentOptions,
  loadLocationOptions,
} from '@/lib/queries';
import { can } from '@/lib/permissions';
import { OrderView } from '@/components/OrderView';
import { pageOrder } from './order-page';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess('purchasing', 'ASSIGNED');
  const order = await pageOrder(() => loadOrderDetail(id, user));
  // Only needed to file new assets, so only loaded for someone who may make
  // them. The three lists are what the "add to assets" dialog files them under.
  const [locations, categories, departments] = order.can.makeAssets
    ? await Promise.all([
        loadLocationOptions(),
        loadAssetCategoryOptions(user),
        loadDepartmentOptions(user),
      ])
    : [[], [], []];

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={`/purchasing?tab=${order.status}`} className="muted" style={{ fontSize: 13 }}>
          ← Purchasing
        </Link>
      </div>
      <OrderView
        order={order}
        locations={locations}
        categories={categories}
        departments={departments}
        // What the dialog may offer to create on the spot.
        canCreate={{
          category: can(user.access, 'categories', 'EDIT'),
          location: can(user.access, 'locations', 'EDIT'),
          department: can(user.access, 'departments', 'EDIT'),
        }}
      />
    </>
  );
}
