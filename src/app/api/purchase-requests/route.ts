import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { requireUser, assertDepartmentAccess, departmentScopeFilter } from '@/lib/auth';
import { purchaseCreateSchema, purchaseStatusEnum } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/** GET /api/purchase-requests?departmentId=&status= */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;

    const where: Prisma.PurchaseRequestWhereInput = { ...departmentScopeFilter(user) };

    const departmentId = params.get('departmentId');
    if (departmentId && departmentId !== 'ALL') {
      assertDepartmentAccess(user, departmentId);
      where.departmentId = departmentId;
    }

    const status = params.get('status');
    if (status && status !== 'ALL') {
      where.status = purchaseStatusEnum.parse(status);
    }

    const requests = await prisma.purchaseRequest.findMany({
      where,
      // Pending first, then most urgent, then oldest - the order an admin wants
      // to work through the queue in.
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
      include: {
        department: { select: { id: true, name: true, code: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        replacesAsset: { select: { id: true, assetTag: true, name: true, status: true } },
      },
    });

    return ok({ requests });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/purchase-requests - flag "this department needs to buy X". */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = purchaseCreateSchema.parse(await readJson(request));

    assertDepartmentAccess(user, body.departmentId);

    // A replacement must point at an asset in the same department, otherwise the
    // report would show a machine from somewhere else entirely.
    if (body.replacesAssetId) {
      const target = await prisma.asset.findUnique({
        where: { id: body.replacesAssetId },
        select: { departmentId: true },
      });
      if (!target) return fail('The asset being replaced no longer exists.', 400);
      if (target.departmentId !== body.departmentId) {
        return fail('The asset being replaced belongs to a different department.', 400);
      }
    }

    const created = await prisma.purchaseRequest.create({
      data: {
        title: body.title,
        category: body.category,
        departmentId: body.departmentId,
        kind: body.kind,
        quantity: body.quantity,
        estimatedCost: body.estimatedCost ?? null,
        justification: body.justification,
        priority: body.priority,
        replacesAssetId: body.replacesAssetId ?? null,
        requestedById: user.id,
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
        requestedBy: { select: { id: true, name: true } },
        replacesAsset: { select: { id: true, assetTag: true, name: true } },
      },
    });

    return ok({ request: created }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
