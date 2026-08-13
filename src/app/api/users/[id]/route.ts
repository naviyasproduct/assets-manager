import { prisma } from '@/lib/db';
import { requireAdmin, hashPassword, revokeAllSessions } from '@/lib/auth';
import { userUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    const body = userUpdateSchema.parse(await readJson(request));

    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true, isActive: true },
    });
    if (!target) return fail('User not found.', 404);

    const nextRole = body.role ?? target.role;

    // Guard against locking everyone out: the last active admin cannot be
    // demoted or deactivated.
    const losingAdmin =
      target.role === 'ADMIN' && (nextRole !== 'ADMIN' || body.isActive === false);

    if (losingAdmin) {
      const otherAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: id } },
      });
      if (otherAdmins === 0) {
        return fail(
          'This is the only active administrator. Promote another administrator first.',
          409,
        );
      }
    }

    if (id === admin.id && body.isActive === false) {
      return fail('You cannot deactivate your own account.', 409);
    }

    const departmentId =
      nextRole === 'ADMIN' ? null : body.departmentId !== undefined ? body.departmentId : undefined;

    if (nextRole === 'DEPT_HEAD' && departmentId === null) {
      return fail('A department head must be assigned to a department.', 400, {
        departmentId: 'Select a department.',
      });
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.newPassword
          ? {
              passwordHash: await hashPassword(body.newPassword),
              mustChangePassword: true,
            }
          : {}),
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

    // A reset password or a deactivated account must take effect at once.
    if (body.newPassword || body.isActive === false) {
      await revokeAllSessions(id);
    }

    return ok({ user });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE - deactivates rather than destroys.
 *
 * Users are referenced by purchase requests and fix records; deleting the row
 * would take the history with it. Deactivating stops all access immediately
 * while keeping "who requested this" answerable.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();

    if (id === admin.id) {
      return fail('You cannot deactivate your own account.', 409);
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (!target) return fail('User not found.', 404);

    if (target.role === 'ADMIN') {
      const otherAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: id } },
      });
      if (otherAdmins === 0) {
        return fail('This is the only active administrator.', 409);
      }
    }

    await prisma.user.update({ where: { id }, data: { isActive: false } });
    await revokeAllSessions(id);

    return ok({ success: true, deactivated: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
