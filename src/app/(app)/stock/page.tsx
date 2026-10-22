import { prisma } from '@/lib/db';
import { departmentScopeFilter, seesAllDepartments } from '@/lib/auth';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { decimalToNumber } from '@/lib/serialize';
import { stockStatus } from '@/lib/stock';
import { mailIsConfigured } from '@/lib/mail';
import { StockManager, type StockRow } from '@/components/StockManager';

export const dynamic = 'force-dynamic';

export default async function StockPage() {
  const user = await requirePageAccess('stock', 'VIEW');

  const items = await prisma.stockItem.findMany({
    where: { asset: departmentScopeFilter(user) },
    include: {
      asset: {
        select: {
          id: true,
          assetTag: true,
          name: true,
          quantity: true,
          unitCost: true,
          photoRelativePath: true,
          photoUploadedAt: true,
          category: { select: { name: true } },
          department: { select: { name: true } },
          location: { select: { name: true } },
        },
      },
    },
  });

  const rows: StockRow[] = items
    .map(({ asset, minLevel }) => ({
      assetId: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      photoUrl: asset.photoRelativePath
        ? `/api/assets/${asset.id}/photo?v=${asset.photoUploadedAt?.getTime() ?? 0}`
        : null,
      categoryName: asset.category.name,
      departmentName: asset.department.name,
      locationName: asset.location?.name ?? null,
      quantity: asset.quantity,
      minLevel,
      unitCost: decimalToNumber(asset.unitCost),
      status: stockStatus(asset.quantity, minLevel),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Stock management</h1>
          <p>
            What is kept on hand. Put an asset here with <strong>Add to stock</strong> on its page;
            the count is the asset&apos;s own quantity.
          </p>
        </div>
      </div>

      <StockManager
        rows={rows}
        canEdit={can(user.access, 'stock', 'EDIT')}
        showDepartment={seesAllDepartments(user)}
        mailOn={mailIsConfigured()}
      />
    </>
  );
}
