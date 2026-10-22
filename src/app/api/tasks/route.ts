import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { taskCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { assertPeopleExist, assertProjectExists } from '@/lib/tasks';

export const runtime = 'nodejs';

/** POST - a new task, on its own or in a project. */
export async function POST(request: Request) {
  try {
    const user = await requireAccess('tasks', 'EDIT');
    const body = taskCreateSchema.parse(await readJson(request));
    await assertProjectExists(body.projectId);
    const assigneeIds = await assertPeopleExist(body.assigneeIds);

    const task = await prisma.task.create({
      data: {
        title: body.title,
        notes: body.notes ?? null,
        projectId: body.projectId ?? null,
        status: body.status,
        priority: body.priority,
        startDate: body.startDate ?? null,
        dueDate: body.dueDate ?? null,
        completedAt: body.status === 'DONE' ? new Date() : null,
        createdById: user.id,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return ok({ task }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
