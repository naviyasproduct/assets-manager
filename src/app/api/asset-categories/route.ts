import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { requireUser, assertDepartmentAccess, departmentScopeFilter } from '@/lib/auth';
import { assetCategoryCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { assetCategoryConflict } from './conflict';

export const runtime = 'nodejs';

/**
 * GET /api/asset-categories?departmentId=
 * Department heads are silently restricted to their own department's categories,
 * the same rule the asset endpoints follow.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;

    const where: Prisma.AssetCategoryWhereInput = { ...departmentScopeFilter(user) };

    const departmentId = params.get('departmentId');
    if (departmentId && departmentId !== 'ALL') {
      assertDepartmentAccess(user, departmentId);
      where.departmentId = departmentId;
    }

    const categories = await prisma.assetCategory.findMany({
      where,
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
      include: {
        department: { select: { id: true, name: true, code: true } },
        _count: { select: { assets: true } },
      },
    });

    return ok({ categories });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/asset-categories
 *
 * Not admin-only, unlike departments: a department head who is adding a machine
 * is exactly the person who knows what group it belongs to, and being unable to
 * name that group is what pushed everyone into free text in the first place.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = assetCategoryCreateSchema.parse(await readJson(request));

    assertDepartmentAccess(user, body.departmentId);

    const category = await prisma.assetCategory.create({
      data: body,
      include: {
        department: { select: { id: true, name: true, code: true } },
        _count: { select: { assets: true } },
      },
    });

    return ok({ category }, 201);
  } catch (error) {
    return assetCategoryConflict(error) ?? handleRouteError(error);
  }
}
