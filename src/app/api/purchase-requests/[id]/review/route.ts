import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { purchaseReviewSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/purchase-requests/[id]/review - admin approves or rejects.
 * Separate from PATCH so the decision is a distinct, auditable action rather
 * than another editable field.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    const body = purchaseReviewSchema.parse(await readJson(request));

    const existing = await prisma.purchaseRequest.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) return fail('Purchase request not found.', 404);

    const updated = await prisma.purchaseRequest.update({
      where: { id },
      data: {
        status: body.status,
        reviewNote: body.reviewNote ?? null,
        reviewedById: admin.id,
        reviewedAt: new Date(),
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });

    return ok({ request: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** DELETE - reopen a decided request, putting it back in the pending queue. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAdmin();

    const updated = await prisma.purchaseRequest.update({
      where: { id },
      data: {
        status: 'PENDING',
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
      },
    });

    return ok({ request: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
