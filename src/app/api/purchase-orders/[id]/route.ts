import { prisma } from '@/lib/db';
import { requireAccess, requireUser, assertDepartmentAccess } from '@/lib/auth';
import { orderUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { deleteImageQuietly } from '@/lib/image-storage';
import {
  assertOrderContents,
  loadOrderDetail,
  loadOrderFacts,
  unique,
  writeOrderItems,
} from '@/lib/purchase-order';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    return ok({ order: await loadOrderDetail(id, user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH - the order's contents: department, note, suppliers, who is assigned,
 * and the lines. A completed order is closed; reopening it (back to Pending)
 * is a status change, and deliberate.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('purchasing', 'EDIT');
    const order = await loadOrderFacts(id, user, 'manage');
    const body = orderUpdateSchema.parse(await readJson(request));

    if (order.status === 'COMPLETED') {
      return fail('This order is completed. Move it back to Pending to change it.', 409);
    }

    const departmentId = body.departmentId ?? order.departmentId;
    if (body.departmentId) assertDepartmentAccess(user, body.departmentId);

    // What the checks run against is the order as it will be once saved.
    const current = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      select: {
        suppliers: { select: { supplierId: true } },
        items: { select: { categoryId: true, basedOnAssetId: true, supplierId: true } },
      },
    });
    const supplierIds = unique(body.supplierIds ?? current.suppliers.map((s) => s.supplierId));
    const assigneeIds = unique(body.assigneeIds ?? order.assigneeIds);
    await assertOrderContents(user, {
      departmentId,
      supplierIds,
      assigneeIds,
      items: body.items ?? current.items,
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          departmentId,
          ...(body.note !== undefined ? { note: body.note } : {}),
          ...(body.supplierIds
            ? {
                suppliers: {
                  deleteMany: {},
                  create: supplierIds.map((supplierId) => ({ supplierId })),
                },
              }
            : {}),
          ...(body.assigneeIds
            ? {
                assignees: { deleteMany: {}, create: assigneeIds.map((userId) => ({ userId })) },
              }
            : {}),
        },
      });
      return body.items ? writeOrderItems(tx, id, body.items) : null;
    });

    for (const path of result?.removedPhotos ?? []) await deleteImageQuietly(path);

    return ok({ order: { id, itemIds: result?.ids ?? null } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE - removes the order and its photos. Refused once any line has become
 * an asset: that order is now the record of where the equipment came from.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('purchasing', 'EDIT');
    await loadOrderFacts(id, user, 'manage');

    const order = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      select: {
        photos: { select: { relativePath: true } },
        items: { select: { photoRelativePath: true, receivedAssetId: true } },
      },
    });

    if (order.items.some((item) => item.receivedAssetId)) {
      return fail(
        'Some of this order is already in the assets list, so the order is kept as the record of where it came from.',
        409,
      );
    }

    await prisma.purchaseOrder.delete({ where: { id } });

    for (const photo of order.photos) await deleteImageQuietly(photo.relativePath);
    for (const item of order.items) await deleteImageQuietly(item.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
