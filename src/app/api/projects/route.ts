import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { projectSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/** POST - a project: a name and a colour. Its dates come from its tasks. */
export async function POST(request: Request) {
  try {
    const user = await requireAccess('tasks', 'EDIT');
    const body = projectSchema.parse(await readJson(request));
    const project = await prisma.project.create({
      data: { name: body.name, description: body.description ?? null, color: body.color, createdById: user.id },
      select: { id: true, name: true, description: true, color: true },
    });
    return ok({ project }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
