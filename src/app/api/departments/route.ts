import { prisma } from '@/lib/db';
import {
  requireUser,
  departmentScopeFilter,
  requireAccess,
  seesAllDepartments,
  AuthError,
} from '@/lib/auth';
import { departmentCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/** GET /api/departments - departments the caller may see. */
export async function GET() {
  try {
    const user = await requireUser();
    const scope = departmentScopeFilter(user);

    const departments = await prisma.department.findMany({
      where: seesAllDepartments(user) ? {} : { id: scope.departmentId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { assets: true, purchaseOrders: true } },
      },
    });

    return ok({ departments });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/departments. Needs edit access to departments AND a view of every
 * department: someone scoped to one would create a department they then could
 * not see.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAccess('departments', 'EDIT');
    if (!seesAllDepartments(user)) {
      throw new AuthError('Only someone who sees every department can add one.', 403);
    }
    const body = departmentCreateSchema.parse(await readJson(request));

    const department = await prisma.department.create({ data: body });

    return ok({ department }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
