import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { requireUser, assertDepartmentAccess, departmentScopeFilter } from '@/lib/auth';
import { assetCreateSchema, assetStatusEnum } from '@/lib/validation';
import { nextAssetTag } from '@/lib/asset-tag';
import { ok, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * GET /api/assets?departmentId=&status=&category=&q=
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

    const category = params.get('category');
    if (category && category !== 'ALL') where.category = category;

    const q = params.get('q')?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { assetTag: { contains: q, mode: 'insensitive' } },
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
      ];
    }

    const assets = await prisma.asset.findMany({
      where,
      orderBy: [{ department: { name: 'asc' } }, { assetTag: 'asc' }],
      include: {
        department: { select: { id: true, name: true, code: true } },
        _count: { select: { fixes: true } },
      },
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

    const asset = await prisma.$transaction(async (tx) => {
      const assetTag = body.assetTag ?? (await nextAssetTag(tx, body.departmentId));

      return tx.asset.create({
        data: {
          assetTag,
          name: body.name,
          category: body.category,
          departmentId: body.departmentId,
          status: body.status,
          serialNumber: body.serialNumber ?? null,
          location: body.location ?? null,
          purchaseDate: body.purchaseDate ?? null,
          purchaseCost: body.purchaseCost ?? null,
          notes: body.notes ?? null,
        },
        include: { department: { select: { id: true, name: true, code: true } } },
      });
    });

    return ok({ asset }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
