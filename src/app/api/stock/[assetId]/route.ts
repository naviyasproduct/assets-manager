import { prisma } from '@/lib/db';
import { assertDepartmentAccess, requireAccess } from '@/lib/auth';
import { stockUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { afterStockChange } from '@/lib/stock';

export const runtime = 'nodejs';

type Params = { params: Promise<{ assetId: string }> };

async function findStocked(assetId: string) {
  return prisma.stockItem.findUnique({
    where: { assetId },
    select: { id: true, asset: { select: { departmentId: true, quantity: true } } },
  });
}

/**
 * PATCH - the limit, stock in/out, or a recount. Writes the asset's own
 * quantity, which is the stock count.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { assetId } = await params;
    const user = await requireAccess('stock', 'EDIT');
    const body = stockUpdateSchema.parse(await readJson(request));

    const item = await findStocked(assetId);
    if (!item) return fail('That asset is not on the Stock page.', 404);
    assertDepartmentAccess(user, item.asset.departmentId);

    if (body.change !== undefined) {
      if (body.change < 0) {
        // Conditional so two people taking stock at once cannot go below zero.
        const taken = await prisma.asset.updateMany({
          where: { id: assetId, quantity: { gte: -body.change } },
          data: { quantity: { increment: body.change } },
        });
        if (taken.count === 0) {
          const now = await prisma.asset.findUnique({ where: { id: assetId }, select: { quantity: true } });
          return fail(`Only ${now?.quantity ?? 0} in stock - you cannot take ${-body.change}.`, 400, {
            change: `Only ${now?.quantity ?? 0} left.`,
          });
        }
      } else {
        // The asset's quantity ceiling applies to the count it becomes.
        const added = await prisma.asset.updateMany({
          where: { id: assetId, quantity: { lte: 9999 - body.change } },
          data: { quantity: { increment: body.change } },
        });
        if (added.count === 0) {
          return fail('That would put more than 9999 in stock.', 400, { change: 'Too many.' });
        }
      }
    }
    if (body.count !== undefined) {
      await prisma.asset.update({ where: { id: assetId }, data: { quantity: body.count } });
    }
    if (body.minLevel !== undefined) {
      await prisma.stockItem.update({ where: { id: item.id }, data: { minLevel: body.minLevel } });
    }

    await afterStockChange(assetId);

    const fresh = await prisma.stockItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { minLevel: true, asset: { select: { quantity: true } } },
    });
    return ok({ quantity: fresh.asset.quantity, minLevel: fresh.minLevel });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** DELETE - takes the asset off the Stock page. The asset and its quantity stay. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { assetId } = await params;
    const user = await requireAccess('stock', 'EDIT');

    const item = await findStocked(assetId);
    if (!item) return fail('That asset is not on the Stock page.', 404);
    assertDepartmentAccess(user, item.asset.departmentId);

    await prisma.stockItem.delete({ where: { id: item.id } });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
