import type { PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { orderStatusSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { loadOrderFacts } from '@/lib/purchase-order';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * The moves an order can make, and who may make them. Forward is the normal
 * path; back is for a mistake, and only someone who manages the order may
 * make it - the person out buying should not be able to un-send a list.
 *
 *   NEW -> PENDING         manage   (handed to whoever is buying)
 *   PENDING -> COMPLETED   work     (it came back)
 *   PENDING -> NEW         manage
 *   COMPLETED -> PENDING   manage   (reopened)
 */
const MOVES: Record<string, 'work' | 'manage'> = {
  'NEW>PENDING': 'manage',
  'PENDING>COMPLETED': 'work',
  'PENDING>NEW': 'manage',
  'COMPLETED>PENDING': 'manage',
};

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const { status } = orderStatusSchema.parse(await readJson(request));

    const order = await loadOrderFacts(id, user, 'see');
    const need = MOVES[`${order.status}>${status}`];
    if (!need) {
      return fail(`An order cannot go from ${order.status.toLowerCase()} to ${status.toLowerCase()}.`, 409);
    }
    await loadOrderFacts(id, user, need);

    if (status === 'COMPLETED') {
      const count = await prisma.purchaseOrderItem.count({ where: { orderId: id } });
      if (count === 0) return fail('An order with nothing on it cannot be completed.', 409);
    }

    const now = new Date();
    const stamps: Record<PurchaseOrderStatus, object> = {
      NEW: { sentAt: null },
      PENDING: order.status === 'NEW' ? { sentAt: now } : { completedAt: null, completedById: null },
      COMPLETED: { completedAt: now, completedById: user.id },
    };

    await prisma.purchaseOrder.update({
      where: { id },
      data: { status, ...stamps[status] },
    });

    return ok({ order: { id, status } });
  } catch (error) {
    return handleRouteError(error);
  }
}
