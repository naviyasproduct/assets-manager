import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { orderBoughtSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { loadOrderFacts } from '@/lib/purchase-order';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH - what each line cost, per unit. For whoever is doing the buying as
 * well as whoever manages the order, and only once it has gone out: before
 * that there is nothing to have paid for.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const order = await loadOrderFacts(id, user, 'work');
    const body = orderBoughtSchema.parse(await readJson(request));

    if (order.status === 'NEW') {
      return fail('Prices go in once the order has been sent out to be bought.', 409);
    }

    const lines = await prisma.purchaseOrderItem.findMany({
      where: { orderId: id, id: { in: body.items.map((item) => item.id) } },
      select: { id: true },
    });
    if (lines.length !== new Set(body.items.map((item) => item.id)).size) {
      return fail('One of those lines is not on this order.', 400);
    }

    await prisma.$transaction(
      body.items.map((item) =>
        prisma.purchaseOrderItem.update({
          where: { id: item.id },
          data: { boughtUnitPrice: item.boughtUnitPrice },
        }),
      ),
    );

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
