import { prisma } from '@/lib/db';
import { requireUser, assertDepartmentAccess } from '@/lib/auth';
import { assetCategoryUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { assetCategoryConflict } from '../conflict';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/asset-categories/[id]
 *
 * Renaming is safe - the name is only ever read through the relation. The code
 * is not rewritten into tags already issued either: those labels are stuck on
 * real machines, so old tags keep the old code and only new ones use the new.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const body = assetCategoryUpdateSchema.parse(await readJson(request));

    const existing = await prisma.assetCategory.findUnique({
      where: { id },
      select: { departmentId: true },
    });
    if (!existing) return fail('Category not found.', 404);

    assertDepartmentAccess(user, existing.departmentId);

    const category = await prisma.assetCategory.update({
      where: { id },
      data: body,
      include: {
        department: { select: { id: true, name: true, code: true } },
        _count: { select: { assets: true } },
      },
    });

    return ok({ category });
  } catch (error) {
    return assetCategoryConflict(error) ?? handleRouteError(error);
  }
}

/**
 * DELETE /api/asset-categories/[id]
 *
 * A category holding assets is never destroyed: the assets would go with it.
 * ?mode=deactivate keeps every record and only hides the category from the
 * add-asset form, which is what "we do not buy these any more" actually means.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const category = await prisma.assetCategory.findUnique({
      where: { id },
      select: { name: true, departmentId: true, _count: { select: { assets: true } } },
    });
    if (!category) return fail('Category not found.', 404);

    assertDepartmentAccess(user, category.departmentId);

    if (new URL(request.url).searchParams.get('mode') === 'deactivate') {
      const updated = await prisma.assetCategory.update({
        where: { id },
        data: { isActive: false },
      });
      return ok({ category: updated, deactivated: true });
    }

    if (category._count.assets > 0) {
      return fail(
        `${category.name} still holds ${category._count.assets} asset(s). Move them to another category first, or deactivate this one instead.`,
        409,
      );
    }

    await prisma.assetCategory.delete({ where: { id } });

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
