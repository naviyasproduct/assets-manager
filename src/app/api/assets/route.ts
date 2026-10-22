import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { assertDepartmentAccess, departmentScopeFilter, requireAccess } from '@/lib/auth';
import { assetBulkDeleteSchema, assetCreateSchema, assetStatusEnum } from '@/lib/validation';
import { nextAssetTag } from '@/lib/asset-tag';
import { assertCategoryInDepartment } from '@/lib/asset-category';
import { canonicalBatch } from '@/lib/asset-batch';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { deleteImageQuietly } from '@/lib/image-storage';

export const runtime = 'nodejs';

const assetInclude = {
  department: { select: { id: true, name: true, code: true } },
  category: { select: { id: true, name: true, code: true } },
  location: { select: { id: true, name: true } },
} as const;

/**
 * GET /api/assets?departmentId=&status=&categoryId=&q=
 * Department heads are silently restricted to their own department regardless
 * of what they pass.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAccess('assets', 'VIEW');
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

    const locationId = params.get('locationId');
    if (locationId && locationId !== 'ALL') where.locationId = locationId;

    const q = params.get('q')?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { assetTag: { contains: q, mode: 'insensitive' } },
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
        { location: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const assets = await prisma.asset.findMany({
      where,
      orderBy: [{ department: { name: 'asc' } }, { assetTag: 'asc' }],
      include: assetInclude,
    });

    return ok({ assets });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/assets */
export async function POST(request: Request) {
  try {
    const user = await requireAccess('assets', 'EDIT');
    const body = assetCreateSchema.parse(await readJson(request));

    assertDepartmentAccess(user, body.departmentId);
    await assertCategoryInDepartment(body.categoryId, body.departmentId);
    const batch = await canonicalBatch(prisma, body.departmentId, body.batch);

    const asset = await prisma.$transaction(async (tx) => {
      // A blank tag means "number it for me" - the common case, and the only one
      // that stays consistent across everyone entering assets at once.
      const assetTag = body.assetTag ?? (await nextAssetTag(tx, body.categoryId));

      return tx.asset.create({
        data: {
          assetTag,
          name: body.name,
          quantity: body.quantity,
          categoryId: body.categoryId,
          departmentId: body.departmentId,
          status: body.status,
          serialNumber: body.serialNumber ?? null,
          locationId: body.locationId ?? null,
          purchaseDate: body.purchaseDate ?? null,
          unitCost: body.unitCost ?? null,
          notes: body.notes ?? null,
          batch,
        },
        include: assetInclude,
      });
    });

    return ok({ asset }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/assets - the ticked rows, removed together, by the same rules as
 * removing one (stock and its history go with the asset; an order line that
 * named it keeps its own record). All or none: one asset outside the caller's
 * departments, or already gone, refuses the lot, so there is never a half-done
 * delete to explain.
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireAccess('assets', 'EDIT');
    const ids = [...new Set(assetBulkDeleteSchema.parse(await readJson(request)).ids)];

    const assets = await prisma.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true, departmentId: true, photoRelativePath: true },
    });
    if (assets.length !== ids.length) {
      return fail('Some of those assets are already gone. The list has been reloaded - tick them again.', 409);
    }
    for (const asset of assets) assertDepartmentAccess(user, asset.departmentId);

    await prisma.asset.deleteMany({ where: { id: { in: ids } } });
    for (const asset of assets) await deleteImageQuietly(asset.photoRelativePath);

    return ok({ deleted: assets.length });
  } catch (error) {
    return handleRouteError(error);
  }
}
