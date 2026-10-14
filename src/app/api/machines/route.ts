import { prisma } from '@/lib/db';
import { assertDepartmentAccess, requireAccess } from '@/lib/auth';
import { machineCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { duplicateNumberResponse } from '@/lib/machine';

export const runtime = 'nodejs';

/** POST - a new machine profile. Its history starts empty, at v0. */
export async function POST(request: Request) {
  try {
    const user = await requireAccess('machines', 'EDIT');
    const body = machineCreateSchema.parse(await readJson(request));
    assertDepartmentAccess(user, body.departmentId);

    const machine = await prisma.machine.create({
      data: { ...body, createdById: user.id },
      select: { id: true },
    });
    return ok({ machine }, 201);
  } catch (error) {
    return duplicateNumberResponse(error) ?? handleRouteError(error);
  }
}
