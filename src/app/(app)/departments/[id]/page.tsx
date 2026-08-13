import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AssetStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser, canAccessDepartment } from '@/lib/auth';
import { loadAssets } from '@/lib/queries';
import { formatMoney } from '@/lib/format';
import { StatusBar, StatusPill } from '@/components/ui';
import { AssetManager } from '@/components/AssetManager';
import { ASSET_STATUS_ORDER } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  if (!canAccessDepartment(user, id)) notFound();

  const department = await prisma.department.findUnique({
    where: { id },
    include: {
      _count: { select: { purchaseRequests: true } },
    },
  });

  if (!department) notFound();

  const assets = await loadAssets(user, { departmentId: id });

  const counts: Record<AssetStatus, number> = {
    IN_USE: 0,
    IDLE: 0,
    NEEDS_REPLACEMENT: 0,
    BROKEN: 0,
  };
  let knownValue = 0;

  for (const asset of assets) {
    counts[asset.status] += 1;
    knownValue += asset.purchaseCost ?? 0;
  }

  const pendingRequests = await prisma.purchaseRequest.count({
    where: { departmentId: id, status: 'PENDING' },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1>{department.name}</h1>
            <span className="pill pill-accent mono">{department.code}</span>
            {!department.isActive ? <span className="pill pill-neutral">Inactive</span> : null}
          </div>
          <p>
            {department.description ?? 'Assets and purchase needs for this department.'}
            {department.location ? ` · ${department.location}` : ''}
          </p>
        </div>
        <div className="row">
          <Link href={`/purchases?departmentId=${id}`} className="btn btn-secondary">
            Purchase planning
          </Link>
          <Link href={`/reports?departmentId=${id}`} className="btn btn-primary">
            Generate report
          </Link>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="stat-label">Assets</div>
          <div className="stat-value">{assets.length}</div>
        </div>
        <div className={`stat${counts.BROKEN + counts.NEEDS_REPLACEMENT > 0 ? ' alert' : ''}`}>
          <div className="stat-label">Need attention</div>
          <div className="stat-value">{counts.BROKEN + counts.NEEDS_REPLACEMENT}</div>
          <div className="stat-note">
            {counts.BROKEN} broken · {counts.NEEDS_REPLACEMENT} to replace
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Requests pending</div>
          <div className="stat-value">{pendingRequests}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Recorded value</div>
          <div className="stat-value">{formatMoney(knownValue)}</div>
          <div className="stat-note">excludes assets with no cost recorded</div>
        </div>
      </div>

      {assets.length > 0 ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body">
            <div className="section-label">Condition</div>
            <StatusBar counts={counts} total={assets.length} />
            <div className="row" style={{ marginTop: 12, gap: 20 }}>
              {ASSET_STATUS_ORDER.map((status) => (
                <span key={status} className="row" style={{ gap: 7, fontSize: 12.5 }}>
                  <StatusPill status={status} />
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{counts[status]}</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <AssetManager
        assets={assets}
        departments={[{ id: department.id, name: department.name }]}
        lockedDepartmentId={department.id}
        showDepartmentColumn={false}
      />
    </>
  );
}
