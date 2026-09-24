import { prisma } from '@/lib/db';
import { requireAdmin, requireAccess, hashPassword } from '@/lib/auth';
import { userCreateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { scopeFor, storedPermissions, toUserJson, userSelect } from './shape';

export const runtime = 'nodejs';

/**
 * GET /api/users - the staff list. Anyone with view access to employees gets
 * the directory; only an admin gets the account details behind it (sign-in
 * history and what each person may open).
 */
export async function GET() {
  try {
    const user = await requireAccess('employees', 'VIEW');

    const users = await prisma.user.findMany({
      where: user.role === 'ADMIN' ? {} : { isActive: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: userSelect,
    });

    const rows = users.map(toUserJson);
    if (user.role === 'ADMIN') return ok({ users: rows });

    return ok({
      users: rows.map(({ access: _a, lastLoginAt: _l, mustChangePassword: _m, ...row }) => row),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = userCreateSchema.parse(await readJson(request));
    const scope = scopeFor(body.role, body.allDepartments, body.departmentId);

    if (scope.departmentId) {
      const exists = await prisma.department.findUnique({
        where: { id: scope.departmentId },
        select: { id: true },
      });
      if (!exists) return fail('That department does not exist.', 400);
    }

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await hashPassword(body.password),
        role: body.role,
        ...scope,
        jobTitle: body.jobTitle ?? null,
        phone: body.phone ?? null,
        permissions: storedPermissions(body.role, body.access),
        // The admin knows this password, so the account holder must replace it.
        mustChangePassword: true,
      },
      select: userSelect,
    });

    return ok({ user: toUserJson(user) }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
