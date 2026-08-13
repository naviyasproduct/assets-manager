import { prisma } from '@/lib/db';
import { requireAdmin, hashPassword } from '@/lib/auth';
import { userCreateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAdmin();

    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        department: { select: { id: true, name: true } },
      },
    });

    return ok({ users });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = userCreateSchema.parse(await readJson(request));

    // Admins are global; a department would be meaningless and misleading.
    const departmentId = body.role === 'ADMIN' ? null : (body.departmentId ?? null);

    if (departmentId) {
      const exists = await prisma.department.findUnique({
        where: { id: departmentId },
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
        departmentId,
        // The admin knows this password, so the account holder must replace it.
        mustChangePassword: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        department: { select: { id: true, name: true } },
      },
    });

    return ok({ user }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
