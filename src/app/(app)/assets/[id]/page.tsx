import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, canAccessDepartment } from '@/lib/auth';
import { buildVideoWatchUrl, isPublicVideoAccessConfigured } from '@/lib/config';
import { decimalToNumber, bigIntToNumber } from '@/lib/serialize';
import { formatMoney, formatDate, ageInYears } from '@/lib/format';
import { StatusPill } from '@/components/ui';
import { FixHistory, type FixRow } from '@/components/FixHistory';

export const dynamic = 'force-dynamic';

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true, code: true } },
      category: { select: { id: true, name: true, code: true } },
      fixes: {
        orderBy: { fixedAt: 'desc' },
        include: { recordedBy: { select: { name: true } } },
      },
    },
  });

  if (!asset) notFound();
  if (!canAccessDepartment(user, asset.departmentId)) notFound();

  const age = ageInYears(asset.purchaseDate);

  const fixes: FixRow[] = asset.fixes.map((fix) => ({
    id: fix.id,
    title: fix.title,
    description: fix.description,
    symptom: fix.symptom,
    fixedByName: fix.fixedByName,
    fixedAt: fix.fixedAt.toISOString(),
    recordedByName: fix.recordedBy.name,
    videoUrl: fix.videoToken ? buildVideoWatchUrl(fix.videoToken) : null,
    videoOriginalName: fix.videoOriginalName,
    videoSizeBytes: bigIntToNumber(fix.videoSizeBytes),
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10, marginBottom: 2 }}>
            <span className="mono muted">{asset.assetTag}</span>
            <StatusPill status={asset.status} />
          </div>
          <h1>{asset.name}</h1>
          <p>
            <Link href={`/assets?categoryId=${asset.category.id}`}>{asset.category.name}</Link> ·{' '}
            <Link href={`/departments/${asset.department.id}`}>{asset.department.name}</Link>
            {asset.location ? ` · ${asset.location}` : ''}
          </p>
        </div>
        <Link href={`/departments/${asset.department.id}`} className="btn btn-secondary">
          Back to department
        </Link>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
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
          <div className="stat-label">Purchase cost</div>
          <div className="stat-value" style={{ fontSize: 19 }}>
            {formatMoney(decimalToNumber(asset.purchaseCost))}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Serial number</div>
          <div className="stat-value mono" style={{ fontSize: 15 }}>
            {asset.serialNumber ?? <span className="muted">Not recorded</span>}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Repairs logged</div>
          <div className="stat-value">{fixes.length}</div>
          <div className="stat-note">
            {fixes.filter((f) => f.videoUrl).length} with video
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

      <FixHistory
        assetId={asset.id}
        assetName={asset.name}
        fixes={fixes}
        videoLinksArePublic={isPublicVideoAccessConfigured()}
      />
    </>
  );
}
