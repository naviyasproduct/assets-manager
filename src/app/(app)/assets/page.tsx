import type { AssetStatus } from '@prisma/client';
import { seesAllDepartments } from '@/lib/auth';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
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
  const user = await requirePageAccess('assets', 'VIEW');
  const allDepartments = seesAllDepartments(user);
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
            {allDepartments
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
        showDepartmentColumn={allDepartments}
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
        canEdit={can(user.access, 'assets', 'EDIT')}
        canCreateDepartment={allDepartments && can(user.access, 'departments', 'EDIT')}
        canCreateLocation={can(user.access, 'locations', 'EDIT')}
      />
    </>
  );
}
