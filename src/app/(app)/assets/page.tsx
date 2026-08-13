import type { AssetStatus } from '@prisma/client';
import { requireUser } from '@/lib/auth';
import { loadAssets, loadDepartmentOptions } from '@/lib/queries';
import { AssetManager } from '@/components/AssetManager';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: AssetStatus[] = ['IN_USE', 'IDLE', 'NEEDS_REPLACEMENT', 'BROKEN'];

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const { status } = await searchParams;

  const [assets, departments] = await Promise.all([
    loadAssets(user),
    loadDepartmentOptions(user),
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
        showDepartmentColumn={user.role === 'ADMIN'}
        initialStatus={initialStatus}
      />
    </>
  );
}
