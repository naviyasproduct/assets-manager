import { prisma } from '@/lib/db';
import { assertDepartmentAccess, requireAccess } from '@/lib/auth';
import { assetOrderResetSchema, assetOrderSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { canonicalBatch } from '@/lib/asset-batch';

export const runtime = 'nodejs';

/**
 * PUT /api/assets/order - one department's order after a drag, top to bottom.
 *
 * The browser works out the order (lib/asset-order.ts); this stores it. A row
 * dropped into a batch joins it here too, in the batch's existing spelling. Raw SQL rather than `update`, so that rearranging the list does
 * not count as editing every asset in it: `@updatedAt` is left alone.
 */
export async function PUT(request: Request) {
  try {
    const user = await requireAccess('assets', 'EDIT');
    const body = assetOrderSchema.parse(await readJson(request));
    assertDepartmentAccess(user, body.departmentId);

    const current = await prisma.asset.findMany({
      where: { departmentId: body.departmentId },
      select: { id: true },
    });
    const known = new Set(current.map((asset) => asset.id));
    const sent = new Set(body.order);

    // Someone added, removed or moved an asset since this list was loaded.
    // Saving a partial order would leave two rows claiming one place.
    if (sent.size !== body.order.length || sent.size !== known.size || body.order.some((id) => !known.has(id))) {
      return fail('The list changed while you were moving that. It has been reloaded - try the move again.', 409);
    }
    if (body.join && !known.has(body.join.id)) return fail('That asset is not in this department.', 400);
    const batch = body.join ? await canonicalBatch(prisma, body.departmentId, body.join.batch) : null;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Asset" AS a SET "listPosition" = o.pos::int
        FROM unnest(${body.order}::text[]) WITH ORDINALITY AS o(id, pos)
        WHERE a.id = o.id`;
      // Joining a batch is a real change to the asset, so this one does
      // count as an edit (updatedAt moves); the reordering above does not.
      if (body.join) await tx.asset.update({ where: { id: body.join.id }, data: { batch } });
    });

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** DELETE /api/assets/order - these departments back to the automatic order. Batches are untouched. */
export async function DELETE(request: Request) {
  try {
    const user = await requireAccess('assets', 'EDIT');
    const { departmentIds } = assetOrderResetSchema.parse(await readJson(request));
    for (const departmentId of departmentIds) assertDepartmentAccess(user, departmentId);

    await prisma.$executeRaw`
      UPDATE "Asset" SET "listPosition" = NULL WHERE "departmentId" = ANY(${departmentIds}::text[])`;

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
