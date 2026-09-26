import { prisma } from '@/lib/db';
import { requireAccess, assertDepartmentAccess } from '@/lib/auth';
import { orderCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import {
  assertOrderContents,
  nextOrderNumber,
  unique,
  writeOrderItems,
} from '@/lib/purchase-order';

export const runtime = 'nodejs';

/**
 * POST /api/purchase-orders - a new order lands in the New tab. Its number is
 * issued here, not by the browser, so it is only ever claimed by an order that
 * actually saved.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAccess('purchasing', 'EDIT');
    const body = orderCreateSchema.parse(await readJson(request));
    assertDepartmentAccess(user, body.departmentId);

    const supplierIds = unique(body.supplierIds);
    const assigneeIds = unique(body.assigneeIds);
    const signOffIds = [
      body.requestedById,
      body.issuedById,
      body.checkedById,
      body.authorizedById,
    ];
    await assertOrderContents(user, { ...body, supplierIds, assigneeIds, signOffIds });

    // A local order has no shipper to agree terms with, so those boxes are not
    // offered and anything posted in them is dropped rather than stored unseen.
    const oversea = body.kind === 'OVERSEA';

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.create({
        data: {
          number: await nextOrderNumber(tx),
          departmentId: body.departmentId,
          kind: body.kind,
          note: body.note ?? null,
          originFrom: oversea ? (body.originFrom ?? null) : null,
          attention: oversea ? (body.attention ?? null) : null,
          deliveryTerms: oversea ? (body.deliveryTerms ?? null) : null,
          paymentTerms: oversea ? (body.paymentTerms ?? null) : null,
          requestedById: body.requestedById ?? null,
          issuedById: body.issuedById ?? null,
          checkedById: body.checkedById ?? null,
          authorizedById: body.authorizedById ?? null,
          createdById: user.id,
          suppliers: { create: supplierIds.map((supplierId) => ({ supplierId })) },
          assignees: { create: assigneeIds.map((userId) => ({ userId })) },
        },
        select: { id: true, number: true },
      });
      const { ids } = await writeOrderItems(tx, order.id, body.items);
      return { ...order, itemIds: ids };
    });

    return ok({ order: result }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
