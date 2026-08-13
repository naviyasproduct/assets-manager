import { prisma } from '@/lib/db';
import { requireUser, requireAdmin, assertDepartmentAccess } from '@/lib/auth';
import { departmentUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    assertDepartmentAccess(user, id);

    const department = await prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { assets: true, purchaseRequests: true } } },
    });

    if (!department) return fail('Department not found.', 404);

    return ok({ department });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAdmin();
    const body = departmentUpdateSchema.parse(await readJson(request));

    const department = await prisma.department.update({ where: { id }, data: body });

    return ok({ department });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/departments/[id]
 *
 * A department holding assets is never silently destroyed - that would orphan
 * asset history the CEO may still need. Callers must either move the assets
 * first, or pass ?mode=deactivate to hide it from day-to-day use while keeping
 * the records intact.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAdmin();

    const mode = new URL(request.url).searchParams.get('mode');

    if (mode === 'deactivate') {
      const department = await prisma.department.update({
        where: { id },
        data: { isActive: false },
      });
      return ok({ department, deactivated: true });
    }

    const counts = await prisma.department.findUnique({
      where: { id },
      select: {
        name: true,
        _count: { select: { assets: true, purchaseRequests: true, users: true } },
      },
    });

    if (!counts) return fail('Department not found.', 404);

    if (counts._count.assets > 0 || counts._count.purchaseRequests > 0) {
      const parts: string[] = [];
      if (counts._count.assets > 0) parts.push(`${counts._count.assets} asset(s)`);
      if (counts._count.purchaseRequests > 0) {
        parts.push(`${counts._count.purchaseRequests} purchase request(s)`);
      }
      return fail(
        `${counts.name} still has ${parts.join(' and ')}. Move or delete them first, or deactivate the department instead.`,
        409,
      );
    }

    // Users are detached rather than deleted: the person still works here.
    await prisma.$transaction([
      prisma.user.updateMany({ where: { departmentId: id }, data: { departmentId: null } }),
      prisma.department.delete({ where: { id } }),
    ]);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
