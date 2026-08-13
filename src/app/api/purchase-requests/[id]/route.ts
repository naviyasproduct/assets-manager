import { prisma } from '@/lib/db';
import { requireUser, assertDepartmentAccess, isAdmin } from '@/lib/auth';
import { purchaseUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const found = await prisma.purchaseRequest.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true, code: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        replacesAsset: { select: { id: true, assetTag: true, name: true, status: true } },
      },
    });

    if (!found) return fail('Purchase request not found.', 404);
    assertDepartmentAccess(user, found.departmentId);

    return ok({ request: found });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH - edit the request itself (not the review decision; that lives at
 * /review). Once an admin has decided, the content is frozen so the record
 * matches what was actually approved.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const body = purchaseUpdateSchema.parse(await readJson(request));

    const existing = await prisma.purchaseRequest.findUnique({
      where: { id },
      select: { departmentId: true, status: true },
    });
    if (!existing) return fail('Purchase request not found.', 404);
    assertDepartmentAccess(user, existing.departmentId);

    if (existing.status !== 'PENDING' && !isAdmin(user)) {
      return fail('This request has already been reviewed and can no longer be edited.', 409);
    }

    if (body.replacesAssetId) {
      const target = await prisma.asset.findUnique({
        where: { id: body.replacesAssetId },
        select: { departmentId: true },
      });
      if (!target || target.departmentId !== existing.departmentId) {
        return fail('The asset being replaced must belong to the same department.', 400);
      }
    }

    const updated = await prisma.purchaseRequest.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.estimatedCost !== undefined ? { estimatedCost: body.estimatedCost } : {}),
        ...(body.justification !== undefined ? { justification: body.justification } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.replacesAssetId !== undefined
          ? { replacesAssetId: body.replacesAssetId }
          : {}),
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        requestedBy: { select: { id: true, name: true } },
        replacesAsset: { select: { id: true, assetTag: true, name: true } },
      },
    });

    return ok({ request: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const existing = await prisma.purchaseRequest.findUnique({
      where: { id },
      select: { departmentId: true, status: true },
    });
    if (!existing) return fail('Purchase request not found.', 404);
    assertDepartmentAccess(user, existing.departmentId);

    // Reviewed requests are part of the decision record; only an admin may erase
    // one.
    if (existing.status !== 'PENDING' && !isAdmin(user)) {
      return fail('This request has already been reviewed and cannot be withdrawn.', 409);
    }

    await prisma.purchaseRequest.delete({ where: { id } });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
