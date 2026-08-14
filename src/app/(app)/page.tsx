import Link from 'next/link';
import type { AssetStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser, departmentScopeFilter } from '@/lib/auth';
import { decimalToNumber } from '@/lib/serialize';
import { formatMoney, formatDate, ASSET_STATUS_ORDER, ASSET_STATUS_LABELS } from '@/lib/format';
import { StatusPill, StatusBar, PriorityPill, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

function emptyCounts(): Record<AssetStatus, number> {
  return { IN_USE: 0, IDLE: 0, NEEDS_REPLACEMENT: 0, BROKEN: 0 };
}

export default async function OverviewPage() {
  const user = await requireUser();
  const scope = departmentScopeFilter(user);
  const isAdmin = user.role === 'ADMIN';

  const [assets, pendingRequests, departments, pendingTotals] = await Promise.all([
    prisma.asset.findMany({
      where: scope,
      select: {
        id: true,
        assetTag: true,
        name: true,
        status: true,
        purchaseCost: true,
        purchaseDate: true,
        department: { select: { id: true, name: true } },
      },
    }),
    prisma.purchaseRequest.findMany({
      where: { ...scope, status: 'PENDING' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 8,
      include: {
        department: { select: { name: true } },
        requestedBy: { select: { name: true } },
      },
    }),
    prisma.department.findMany({
      where: isAdmin ? {} : { id: scope.departmentId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { assets: true } } },
    }),
    // Every pending request, not just the eight shown in the table - the stat
    // tile must report the real total.
    prisma.purchaseRequest.findMany({
      where: { ...scope, status: 'PENDING' },
      select: { estimatedCost: true, quantity: true },
    }),
  ]);

  const counts = emptyCounts();
  let knownValue = 0;
  for (const asset of assets) {
    counts[asset.status] += 1;
    knownValue += decimalToNumber(asset.purchaseCost) ?? 0;
  }

  const needsAttention = counts.BROKEN + counts.NEEDS_REPLACEMENT;

  const attentionAssets = assets
    .filter((a) => a.status === 'BROKEN' || a.status === 'NEEDS_REPLACEMENT')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'BROKEN' ? -1 : 1))
    .slice(0, 8);

  const pendingCount = pendingTotals.length;
  const pendingEstimate = pendingTotals.reduce(
    (sum, r) => sum + (decimalToNumber(r.estimatedCost) ?? 0) * r.quantity,
    0,
  );

  // Per-department condition breakdown, admin only - a department head already
  // sees their own numbers in the tiles above.
  const byDepartment = isAdmin
    ? departments.map((department) => {
        const deptCounts = emptyCounts();
        let total = 0;
        for (const asset of assets) {
          if (asset.department.id === department.id) {
            deptCounts[asset.status] += 1;
            total += 1;
          }
        }
        return { department, counts: deptCounts, total };
      })
    : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {isAdmin
              ? 'Condition of equipment across every department, and what is waiting on a decision.'
              : `Equipment and purchase needs for ${user.department?.name ?? 'your department'}.`}
          </p>
        </div>
        <Link href="/reports" className="btn btn-primary">
          Generate report
        </Link>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="stat-label">Assets tracked</div>
          <div className="stat-value">{assets.length}</div>
          <div className="stat-note">
            across {departments.length} department{departments.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className={`stat${needsAttention > 0 ? ' alert' : ''}`}>
          <div className="stat-label">Need attention</div>
          <div className="stat-value">{needsAttention}</div>
          <div className="stat-note">
            {counts.BROKEN} broken · {counts.NEEDS_REPLACEMENT} due for replacement
          </div>
        </div>

        <div className="stat">
          <div className="stat-label">Awaiting decision</div>
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-note">purchase requests pending</div>
        </div>

        <div className="stat">
          <div className="stat-label">Estimated spend</div>
          <div className="stat-value">{formatMoney(pendingEstimate)}</div>
          <div className="stat-note">if all pending requests approved</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <h2>Condition of tracked assets</h2>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Recorded value {formatMoney(knownValue)}
          </span>
        </div>
        <div className="card-body">
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

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Equipment needing a decision</h2>
            <Link href="/assets?status=BROKEN" className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          {attentionAssets.length === 0 ? (
            <EmptyState
              title="Nothing flagged"
              message="No equipment is currently broken or marked for replacement."
            />
          ) : (
            <div className="table-wrap">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    {isAdmin ? <th>Department</th> : null}
                    <th>Status</th>
                    <th className="num">Purchased</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <Link href={`/assets/${asset.id}`} style={{ fontWeight: 600 }}>
                          {asset.name}
                        </Link>
                        <div className="cell-sub mono">{asset.assetTag}</div>
                      </td>
                      {isAdmin ? <td>{asset.department.name}</td> : null}
                      <td>
                        <StatusPill status={asset.status} />
                      </td>
                      <td className="num nowrap">{formatDate(asset.purchaseDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Purchase requests pending</h2>
            <Link href="/purchases" className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          {pendingRequests.length === 0 ? (
            <EmptyState
              title="Nothing pending"
              message="No purchase needs are currently flagged for review."
            />
          ) : (
            <div className="table-wrap">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    {isAdmin ? <th>Department</th> : null}
                    <th>Priority</th>
                    <th className="num">Estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{request.title}</span>
                        <div className="cell-sub">
                          {request.quantity} × {request.category}
                        </div>
                      </td>
                      {isAdmin ? <td>{request.department.name}</td> : null}
                      <td>
                        <PriorityPill priority={request.priority} />
                      </td>
                      <td className="num nowrap">
                        {formatMoney(
                          (decimalToNumber(request.estimatedCost) ?? 0) * request.quantity,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {isAdmin && byDepartment.length > 0 ? (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-head">
            <h2>By department</h2>
          </div>
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th className="num">Assets</th>
                  <th style={{ width: '35%' }}>Condition</th>
                  {ASSET_STATUS_ORDER.map((status) => (
                    <th key={status} className="num">
                      {ASSET_STATUS_LABELS[status]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byDepartment.map(({ department, counts: deptCounts, total }) => (
                  <tr key={department.id}>
                    <td>
                      <Link href={`/departments/${department.id}`} style={{ fontWeight: 600 }}>
                        {department.name}
                      </Link>
                      <div className="cell-sub mono">{department.code}</div>
                    </td>
                    <td className="num">{total}</td>
                    <td style={{ paddingTop: 16 }}>
                      <StatusBar counts={deptCounts} total={total} />
                    </td>
                    {ASSET_STATUS_ORDER.map((status) => (
                      <td key={status} className="num">
                        {deptCounts[status] || <span className="muted">-</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
