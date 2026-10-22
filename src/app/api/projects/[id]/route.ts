import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { projectUpdateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson, NotFoundError } from '@/lib/api';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

async function assertProject(id: string) {
  const found = await prisma.project.count({ where: { id } });
  if (!found) throw new NotFoundError('Project not found.');
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('tasks', 'EDIT');
    const body = projectUpdateSchema.parse(await readJson(request));
    await assertProject(id);
    await prisma.project.update({ where: { id }, data: body });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** DELETE - the project only. Its tasks stay, as tasks on their own (the foreign key sets them loose). */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('tasks', 'EDIT');
    await assertProject(id);
    await prisma.project.delete({ where: { id } });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
