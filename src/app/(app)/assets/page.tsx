import type { AssetStatus } from '@prisma/client';
import { requireUser } from '@/lib/auth';
import {
  loadAssets,
  loadDepartmentOptions,
  loadAssetCategoryOptions,
  loadLocationOptions,
} from '@/lib/queries';
import { AssetManager } from '@/components/AssetManager';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: AssetStatus[] = ['IN_USE', 'IDLE', 'NEEDS_REPLACEMENT', 'BROKEN'];

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; categoryId?: string; locationId?: string }>;
}) {
  const user = await requireUser();
  const { status, categoryId, locationId } = await searchParams;

  const [assets, departments, categories, locations] = await Promise.all([
    loadAssets(user),
    loadDepartmentOptions(user),
    loadAssetCategoryOptions(user),
    loadLocationOptions(),
  ]);

  const initialStatus =
    status && VALID_STATUSES.includes(status as AssetStatus)
      ? (status as AssetStatus)
      : 'ALL';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Assets</h1>
          <p>
            {user.role === 'ADMIN'
              ? 'Every asset across all departments.'
              : `Equipment owned by ${user.department?.name ?? 'your department'}.`}
          </p>
        </div>
      </div>

      <AssetManager
        assets={assets}
        departments={departments}
        categories={categories}
        locations={locations}
        showDepartmentColumn={user.role === 'ADMIN'}
        initialStatus={initialStatus}
        // Only honoured when it is a category the user can actually see.
        initialCategoryId={
          categoryId && categories.some((category) => category.id === categoryId)
            ? categoryId
            : undefined
        }
        initialLocationId={
          locationId && locations.some((location) => location.id === locationId)
            ? locationId
            : undefined
        }
        canCreateDepartment={user.role === 'ADMIN'}
        canCreateLocation={user.role === 'ADMIN'}
      />
    </>
  );
}
