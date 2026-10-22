import { prisma } from '@/lib/db';
import { assertDepartmentAccess, requireAccess } from '@/lib/auth';
import { assetOrderResetSchema, assetOrderSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * PUT /api/assets/order - one department's order after a drag, top to bottom.
 *
 * The browser works out the order and the group (lib/asset-order.ts); this
 * stores it. Raw SQL rather than `update`, so that rearranging the list does
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
    if (body.moved && !known.has(body.moved.id)) {
      return fail('That asset is not in this department.', 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Asset" AS a SET "listPosition" = o.pos::int
        FROM unnest(${body.order}::text[]) WITH ORDINALITY AS o(id, pos)
        WHERE a.id = o.id`;
      if (body.moved) {
        await tx.$executeRaw`
          UPDATE "Asset" SET "listGroup" = ${body.moved.listGroup} WHERE id = ${body.moved.id}`;
      }
    });

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/assets/order - these departments back to the automatic order.
 * Groups made by dragging stay: the order is easy to get back, a group someone
 * put together by hand is not.
 */
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
