import { prisma } from '@/lib/db';
import { assertDepartmentAccess, requireAccess } from '@/lib/auth';
import { machineUpdateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { duplicateNumberResponse, loadMachineFacts } from '@/lib/machine';
import { deleteMachineFolder } from '@/lib/machine-files';
import { deleteImageQuietly } from '@/lib/image-storage';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('machines', 'EDIT');
    const body = machineUpdateSchema.parse(await readJson(request));
    const machine = await loadMachineFacts(id, user);
    // Moving it means being allowed into the department it moves to as well.
    if (body.departmentId && body.departmentId !== machine.departmentId) {
      assertDepartmentAccess(user, body.departmentId);
    }

    const updated = await prisma.machine.update({ where: { id }, data: body, select: { id: true } });
    return ok({ machine: updated });
  } catch (error) {
    return duplicateNumberResponse(error) ?? handleRouteError(error);
  }
}

/**
 * DELETE - the machine and its whole history, files included. The confirm on
 * the page says so; this is for a machine entered by mistake or scrapped.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('machines', 'EDIT');
    await loadMachineFacts(id, user);

    const photos = await prisma.machinePhoto.findMany({ where: { machineId: id }, select: { relativePath: true } });
    await prisma.machine.delete({ where: { id } });
    await deleteMachineFolder(id);
    for (const photo of photos) await deleteImageQuietly(photo.relativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
