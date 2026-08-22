import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { requireUser, assertDepartmentAccess } from '@/lib/auth';
import { assetUpdateSchema } from '@/lib/validation';
import { assertCategoryInDepartment } from '@/lib/asset-category';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { deleteQuietly } from '@/lib/video-storage';
import { deleteImageQuietly } from '@/lib/image-storage';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const asset = await prisma.asset.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true, code: true } },
        category: { select: { id: true, name: true, code: true } },
        location: { select: { id: true, name: true } },
        fixes: {
          orderBy: { fixedAt: 'desc' },
          include: { recordedBy: { select: { id: true, name: true } } },
        },
      },
    });

    if (!asset) return fail('Asset not found.', 404);
    assertDepartmentAccess(user, asset.departmentId);

    return ok({ asset });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const body = assetUpdateSchema.parse(await readJson(request));

    const existing = await prisma.asset.findUnique({
      where: { id },
      select: { departmentId: true, categoryId: true },
    });
    if (!existing) return fail('Asset not found.', 404);

    // Must be allowed to touch both the current department and, when moving the
    // asset, the destination.
    assertDepartmentAccess(user, existing.departmentId);
    if (body.departmentId && body.departmentId !== existing.departmentId) {
      assertDepartmentAccess(user, body.departmentId);
    }

    // Moving an asset between departments also has to move it to a category the
    // destination owns, so the pair is re-checked whenever either side changes.
    if (body.categoryId !== undefined || body.departmentId !== undefined) {
      await assertCategoryInDepartment(
        body.categoryId ?? existing.categoryId,
        body.departmentId ?? existing.departmentId,
      );
    }

    // Build the update explicitly: a partial schema means "field absent = leave
    // alone", but an explicit null means "clear it".
    const data: Prisma.AssetUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.categoryId !== undefined) data.category = { connect: { id: body.categoryId } };
    if (body.status !== undefined) data.status = body.status;
    if (body.assetTag !== undefined && body.assetTag !== null) data.assetTag = body.assetTag;
    if (body.serialNumber !== undefined) data.serialNumber = body.serialNumber;
    // A location is optional, so clearing the field has to actually detach it
    // rather than connect to nothing.
    if (body.locationId !== undefined) {
      data.location = body.locationId
        ? { connect: { id: body.locationId } }
        : { disconnect: true };
    }
    if (body.purchaseDate !== undefined) data.purchaseDate = body.purchaseDate;
    if (body.purchaseCost !== undefined) data.purchaseCost = body.purchaseCost;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.departmentId !== undefined && body.departmentId !== null) {
      data.department = { connect: { id: body.departmentId } };
    }

    const asset = await prisma.asset.update({
      where: { id },
      data,
      include: {
        department: { select: { id: true, name: true, code: true } },
        category: { select: { id: true, name: true, code: true } },
        location: { select: { id: true, name: true } },
      },
    });

    return ok({ asset });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/assets/[id]
 *
 * Cascades to the machine-fix rows, so the video files on disk have to be
 * removed by hand or they would be orphaned forever.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const asset = await prisma.asset.findUnique({
      where: { id },
      select: {
        departmentId: true,
        photoRelativePath: true,
        fixes: { select: { videoRelativePath: true } },
      },
    });
    if (!asset) return fail('Asset not found.', 404);
    assertDepartmentAccess(user, asset.departmentId);

    await prisma.asset.delete({ where: { id } });

    for (const fix of asset.fixes) {
      await deleteQuietly(fix.videoRelativePath);
    }
    await deleteImageQuietly(asset.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
