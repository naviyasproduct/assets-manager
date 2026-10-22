import { prisma } from '@/lib/db';
import { AuthError, requireAccess } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { taskUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { assertPeopleExist, assertProjectExists, loadTaskFacts } from '@/lib/tasks';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH - any part of a task. Tasks Edit may change anything. Below that, the
 * one thing allowed is the status, and only by someone the task is assigned
 * to: whoever did the job ticks it off, without being able to replan it.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('tasks', 'VIEW');
    const body = taskUpdateSchema.parse(await readJson(request));
    const task = await loadTaskFacts(id);

    if (!can(user.access, 'tasks', 'EDIT')) {
      const onlyStatus = Object.keys(body).every((key) => key === 'status');
      if (!onlyStatus || !task.assigneeIds.includes(user.id)) {
        throw new AuthError('Only the people on a task can tick it off, and only tasks Edit can change it.', 403);
      }
    }

    // The dates are checked as they will be stored, so moving only the start
    // past the due date is caught as well.
    const start = body.startDate !== undefined ? body.startDate : task.startDate;
    const due = body.dueDate !== undefined ? body.dueDate : task.dueDate;
    if (start && due && start > due) {
      return fail('The due date is before the start.', 422, { dueDate: 'The due date is before the start.' });
    }
    if (body.projectId !== undefined) await assertProjectExists(body.projectId);
    const assigneeIds = body.assigneeIds !== undefined ? await assertPeopleExist(body.assigneeIds) : undefined;

    const { assigneeIds: _ids, ...fields } = body;
    const completedAt =
      body.status === undefined || (body.status === 'DONE') === (task.status === 'DONE')
        ? undefined
        : body.status === 'DONE'
          ? new Date()
          : null;

    await prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: { ...fields, completedAt } });
      if (assigneeIds) {
        await tx.taskAssignee.deleteMany({ where: { taskId: id } });
        await tx.taskAssignee.createMany({ data: assigneeIds.map((userId) => ({ taskId: id, userId })) });
      }
    });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('tasks', 'EDIT');
    await loadTaskFacts(id);
    await prisma.task.delete({ where: { id } });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
