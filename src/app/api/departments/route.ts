import { prisma } from '@/lib/db';
import { requireUser, requireAdmin, departmentScopeFilter } from '@/lib/auth';
import { departmentCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/** GET /api/departments - departments the caller may see. */
export async function GET() {
  try {
    const user = await requireUser();
    const scope = departmentScopeFilter(user);

    const departments = await prisma.department.findMany({
      where: user.role === 'ADMIN' ? {} : { id: scope.departmentId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { assets: true, purchaseRequests: true } },
      },
    });

    return ok({ departments });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/departments - admin only. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = departmentCreateSchema.parse(await readJson(request));

    const department = await prisma.department.create({ data: body });

    return ok({ department }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
