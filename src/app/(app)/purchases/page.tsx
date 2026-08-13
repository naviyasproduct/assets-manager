import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, departmentScopeFilter, canAccessDepartment } from '@/lib/auth';
import { loadDepartmentOptions } from '@/lib/queries';
import { decimalToNumber } from '@/lib/serialize';
import { formatMoney } from '@/lib/format';
import { PurchaseManager, type PurchaseRow, type ReplaceableAsset } from '@/components/PurchaseManager';

export const dynamic = 'force-dynamic';

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string }>;
}) {
  const user = await requireUser();
  const { departmentId } = await searchParams;

  if (departmentId && !canAccessDepartment(user, departmentId)) notFound();

  const scope = departmentScopeFilter(user);
  const where = { ...scope, ...(departmentId ? { departmentId } : {}) };

  const [requests, departments, assets] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
      include: {
        department: { select: { id: true, name: true } },
        requestedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
        replacesAsset: { select: { id: true, assetTag: true, name: true } },
      },
    }),
    loadDepartmentOptions(user),
    prisma.asset.findMany({
      where: scope,
      orderBy: [{ assetTag: 'asc' }],
      select: { id: true, assetTag: true, name: true, departmentId: true, status: true },
    }),
  ]);

  const rows: PurchaseRow[] = requests.map((request) => {
    const unitCost = decimalToNumber(request.estimatedCost);
    return {
      id: request.id,
      title: request.title,
      category: request.category,
      kind: request.kind,
      quantity: request.quantity,
      estimatedCost: unitCost,
      lineTotal: unitCost === null ? null : unitCost * request.quantity,
      justification: request.justification,
      priority: request.priority,
      status: request.status,
      departmentId: request.departmentId,
      departmentName: request.department.name,
      requestedByName: request.requestedBy.name,
      requestedAt: request.createdAt.toISOString(),
      reviewedByName: request.reviewedBy?.name ?? null,
      reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
      reviewNote: request.reviewNote,
      replacesAssetId: request.replacesAssetId,
      replacesAssetTag: request.replacesAsset?.assetTag ?? null,
      replacesAssetName: request.replacesAsset?.name ?? null,
    };
  });

  const replaceable: ReplaceableAsset[] = assets.map((asset) => ({
    id: asset.id,
    assetTag: asset.assetTag,
    name: asset.name,
    departmentId: asset.departmentId,
  }));

  const pending = rows.filter((r) => r.status === 'PENDING');
  const pendingTotal = pending.reduce((sum, r) => sum + (r.lineTotal ?? 0), 0);
  const approvedTotal = rows
    .filter((r) => r.status === 'APPROVED')
    .reduce((sum, r) => sum + (r.lineTotal ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Purchase planning</h1>
          <p>
            Equipment each department needs to buy or replace.
            {user.role === 'ADMIN'
              ? ' Review these before they reach the CEO in a report.'
              : ' Flagged items are reviewed by an administrator.'}
          </p>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="stat-label">Awaiting decision</div>
          <div className="stat-value">{pending.length}</div>
          <div className="stat-note">
            {pending.filter((r) => r.priority === 'CRITICAL').length} marked critical
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Pending spend</div>
          <div className="stat-value">{formatMoney(pendingTotal)}</div>
          <div className="stat-note">if everything pending is approved</div>
        </div>
        <div className="stat">
          <div className="stat-label">Approved so far</div>
          <div className="stat-value">{formatMoney(approvedTotal)}</div>
        </div>
      </div>

      <PurchaseManager
        requests={rows}
        departments={departments}
        assets={replaceable}
        isAdmin={user.role === 'ADMIN'}
        showDepartmentColumn={user.role === 'ADMIN'}
      />
    </>
  );
}
