import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { requireUser, assertDepartmentAccess, departmentScopeFilter } from '@/lib/auth';
import { assetCreateSchema, assetStatusEnum } from '@/lib/validation';
import { nextAssetTag } from '@/lib/asset-tag';
import { assertCategoryInDepartment } from '@/lib/asset-category';
import { ok, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

const assetInclude = {
  department: { select: { id: true, name: true, code: true } },
  category: { select: { id: true, name: true, code: true } },
} as const;

/**
 * GET /api/assets?departmentId=&status=&categoryId=&q=
 * Department heads are silently restricted to their own department regardless
 * of what they pass.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;

    const where: Prisma.AssetWhereInput = { ...departmentScopeFilter(user) };

    const departmentId = params.get('departmentId');
    if (departmentId && departmentId !== 'ALL') {
      assertDepartmentAccess(user, departmentId);
      where.departmentId = departmentId;
    }

    const status = params.get('status');
    if (status && status !== 'ALL') {
      where.status = assetStatusEnum.parse(status);
    }

    const categoryId = params.get('categoryId');
    if (categoryId && categoryId !== 'ALL') where.categoryId = categoryId;

    const q = params.get('q')?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { assetTag: { contains: q, mode: 'insensitive' } },
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
        { location: { contains: q, mode: 'insensitive' } },
      ];
    }

    const assets = await prisma.asset.findMany({
      where,
      orderBy: [{ department: { name: 'asc' } }, { assetTag: 'asc' }],
      include: { ...assetInclude, _count: { select: { fixes: true } } },
    });

    return ok({ assets });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/assets */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = assetCreateSchema.parse(await readJson(request));

    assertDepartmentAccess(user, body.departmentId);
    await assertCategoryInDepartment(body.categoryId, body.departmentId);

    const asset = await prisma.$transaction(async (tx) => {
      // A blank tag means "number it for me" - the common case, and the only one
      // that stays consistent across everyone entering assets at once.
      const assetTag = body.assetTag ?? (await nextAssetTag(tx, body.categoryId));

      return tx.asset.create({
        data: {
          assetTag,
          name: body.name,
          categoryId: body.categoryId,
          departmentId: body.departmentId,
          status: body.status,
          serialNumber: body.serialNumber ?? null,
          location: body.location ?? null,
          purchaseDate: body.purchaseDate ?? null,
          purchaseCost: body.purchaseCost ?? null,
          notes: body.notes ?? null,
        },
        include: assetInclude,
      });
    });

    return ok({ asset }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
