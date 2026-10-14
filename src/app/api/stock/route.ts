import { prisma } from '@/lib/db';
import { assertDepartmentAccess, requireAccess } from '@/lib/auth';
import { stockAddSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { afterStockChange } from '@/lib/stock';

export const runtime = 'nodejs';

/**
 * POST - puts an asset on the Stock page. Nothing about the asset changes: its
 * quantity simply starts being watched against the limit.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAccess('stock', 'EDIT');
    const body = stockAddSchema.parse(await readJson(request));

    const asset = await prisma.asset.findUnique({
      where: { id: body.assetId },
      select: { departmentId: true, stock: { select: { id: true } } },
    });
    if (!asset) return fail('Asset not found.', 404);
    assertDepartmentAccess(user, asset.departmentId);
    if (asset.stock) return fail('That asset is already on the Stock page.', 409);

    const item = await prisma.stockItem.create({
      data: { assetId: body.assetId, minLevel: body.minLevel, addedById: user.id },
      select: { id: true },
    });
    await afterStockChange(body.assetId);

    return ok({ item }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
