import { prisma } from '@/lib/db';
import { assertDepartmentAccess, requireAccess } from '@/lib/auth';
import { stockUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { afterStockChange, logStockMovement } from '@/lib/stock';

export const runtime = 'nodejs';

type Params = { params: Promise<{ assetId: string }> };

/** Enough to see what has been happening; older lines stay in the database. */
const HISTORY_LIMIT = 100;

async function findStocked(assetId: string) {
  return prisma.stockItem.findUnique({
    where: { assetId },
    select: { id: true, asset: { select: { departmentId: true, quantity: true } } },
  });
}

/** GET - the item's history, newest first, for the Stock in and Usage windows. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { assetId } = await params;
    const user = await requireAccess('stock', 'VIEW');

    const item = await findStocked(assetId);
    if (!item) return fail('That asset is not on the Stock page.', 404);
    assertDepartmentAccess(user, item.asset.departmentId);

    const movements = await prisma.stockMovement.findMany({
      where: { assetId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { id: true, kind: true, change: true, quantityAfter: true, note: true, createdAt: true },
    });
    return ok({ movements });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH - the limit, stock in / usage, or a recount. Writes the asset's own
 * quantity, which is the stock count, and a line of history for any change.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { assetId } = await params;
    const user = await requireAccess('stock', 'EDIT');
    const body = stockUpdateSchema.parse(await readJson(request));

    const item = await findStocked(assetId);
    if (!item) return fail('That asset is not on the Stock page.', 404);
    assertDepartmentAccess(user, item.asset.departmentId);

    // The count and its line of history commit together. Reading the count
    // back inside the transaction gives the exact figure left: the row stays
    // locked by the update until commit, so nobody else's change gets between.
    const refused = await prisma.$transaction(async (tx) => {
      if (body.change !== undefined) {
        const change = body.change;
        // Conditional so two people taking stock at once cannot go below
        // zero; the asset's quantity ceiling applies to the count it becomes.
        const updated = await tx.asset.updateMany({
          where: change < 0
            ? { id: assetId, quantity: { gte: -change } }
            : { id: assetId, quantity: { lte: 9999 - change } },
          data: { quantity: { increment: change } },
        });
        if (updated.count === 0) {
          if (change > 0) return fail('That would put more than 9999 in stock.', 400, { change: 'Too many.' });
          const now = await tx.asset.findUnique({ where: { id: assetId }, select: { quantity: true } });
          return fail(`Only ${now?.quantity ?? 0} in stock - you cannot take ${-change}.`, 400, {
            change: `Only ${now?.quantity ?? 0} left.`,
          });
        }
        const { quantity } = await tx.asset.findUniqueOrThrow({ where: { id: assetId }, select: { quantity: true } });
        await logStockMovement(tx, {
          assetId,
          kind: change > 0 ? 'IN' : 'USAGE',
          change,
          quantityAfter: quantity,
          userId: user.id,
        });
      }
      if (body.count !== undefined) {
        const before = await tx.asset.findUniqueOrThrow({ where: { id: assetId }, select: { quantity: true } });
        await tx.asset.update({ where: { id: assetId }, data: { quantity: body.count } });
        await logStockMovement(tx, {
          assetId,
          kind: 'COUNT',
          change: body.count - before.quantity,
          quantityAfter: body.count,
          userId: user.id,
        });
      }
      return null;
    });
    if (refused) return refused;
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
