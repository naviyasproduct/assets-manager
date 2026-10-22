import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { canAccessDepartment } from '@/lib/auth';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { decimalToNumber } from '@/lib/serialize';
import { formatMoney, formatDate, ageInYears } from '@/lib/format';
import { BackButton, StatusPill } from '@/components/ui';
import { AddToStockButton } from '@/components/StockManager';
import { stockStatus } from '@/lib/stock';

export const dynamic = 'force-dynamic';

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageAccess('assets', 'VIEW');

  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true, code: true } },
      category: { select: { id: true, name: true, code: true } },
      location: { select: { id: true, name: true } },
      stock: { select: { minLevel: true } },
    },
  });

  if (!asset) notFound();
  if (!canAccessDepartment(user, asset.departmentId)) notFound();

  const age = ageInYears(asset.purchaseDate);
  const stocked = asset.stock ? stockStatus(asset.quantity, asset.stock.minLevel) : null;
  const unitCost = decimalToNumber(asset.unitCost);


  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <BackButton fallback="/assets">← Back</BackButton>
      </div>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10, marginBottom: 2 }}>
            <span className="mono muted">{asset.assetTag}</span>
            <StatusPill status={asset.status} />
            {asset.quantity > 1 ? (
              <span className="pill pill-neutral">× {asset.quantity} units</span>
            ) : null}
            {asset.batch ? <span className="pill pill-accent">Batch: {asset.batch}</span> : null}
          </div>
          <h1>{asset.name}</h1>
          <p>
            <Link href={`/assets?categoryId=${asset.category.id}`}>{asset.category.name}</Link> ·{' '}
            <Link href={`/departments/${asset.department.id}`}>{asset.department.name}</Link>
            {asset.location ? (
              <>
                {' · '}
                <Link href={`/assets?locationId=${asset.location.id}`}>{asset.location.name}</Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="row">
          {stocked && can(user.access, 'stock', 'VIEW') ? (
            <Link href="/stock" className="btn btn-secondary" title="Open the Stock page">
              On stock ·{' '}
              <span style={{ color: stocked === 'OK' ? 'var(--ok)' : stocked === 'LOW' ? 'var(--warn)' : 'var(--bad)' }}>
                {stocked === 'OK' ? `${asset.quantity} on hand` : stocked === 'LOW' ? `${asset.quantity} left - low` : 'out'}
              </span>
            </Link>
          ) : null}
          {!stocked && can(user.access, 'stock', 'EDIT') ? <AddToStockButton assetId={asset.id} /> : null}
          <Link href={`/departments/${asset.department.id}`} className="btn btn-secondary">
            Back to department
          </Link>
        </div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="stat-label">Purchased</div>
          <div className="stat-value" style={{ fontSize: 19 }}>
            {formatDate(asset.purchaseDate)}
          </div>
          <div className="stat-note">
            {age === null ? 'date not recorded' : `${age} year${age === 1 ? '' : 's'} old`}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Unit price</div>
          <div className="stat-value" style={{ fontSize: 19 }}>
            {formatMoney(unitCost)}
          </div>
          {unitCost !== null && asset.quantity > 1 ? (
            <div className="stat-note">
              {formatMoney(unitCost * asset.quantity)} for {asset.quantity}
            </div>
          ) : null}
        </div>
        <div className="stat">
          <div className="stat-label">Serial number</div>
          <div className="stat-value mono" style={{ fontSize: 15 }}>
            {asset.serialNumber ?? <span className="muted">Not recorded</span>}
          </div>
        </div>
      </div>

      {asset.photoRelativePath || asset.notes ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body">
            <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
              {asset.photoRelativePath ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/assets/${asset.id}/photo?v=${asset.photoUploadedAt?.getTime() ?? 0}`}
                  alt={`Photo of ${asset.name}`}
                  style={{
                    width: 200,
                    height: 200,
                    objectFit: 'cover',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--rule)',
                    display: 'block',
                  }}
                />
              ) : null}

              {asset.notes ? (
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div className="section-label">Notes</div>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{asset.notes}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}
