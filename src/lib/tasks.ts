import 'server-only';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/api';
import { dayOf } from '@/lib/days';
import { personPhotoUrl } from '@/lib/queries';
import { PROJECT_COLORS, type ProjectColor, type ProjectRow, type TaskPerson, type TaskRow } from '@/lib/task-types';

/**
 * Reading the to-do list out, and the checks a foreign key cannot make about
 * a task. Tasks are site-wide - everyone with the tasks area sees all of them -
 * so nothing here filters by department.
 */

const taskSelect = {
  id: true,
  title: true,
  notes: true,
  projectId: true,
  status: true,
  priority: true,
  startDate: true,
  dueDate: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  assignees: { select: { userId: true } },
} as const;

export async function loadTaskBoard() {
  const [projects, tasks, people] = await Promise.all([
    prisma.project.findMany({ orderBy: [{ name: 'asc' }] }),
    prisma.task.findMany({ orderBy: [{ createdAt: 'asc' }], select: taskSelect }),
    // Everyone, with a login or without: most of the people jobs are given to
    // are staff who never sign in (see api/machines/people).
    prisma.user.findMany({
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, jobTitle: true, photoRelativePath: true, photoUploadedAt: true },
    }),
  ]);

  return {
    projects: projects.map(
      (p): ProjectRow => ({
        id: p.id,
        name: p.name,
        description: p.description,
        // A colour retired from the palette falls back rather than breaking the bar.
        color: (PROJECT_COLORS as readonly string[]).includes(p.color) ? (p.color as ProjectColor) : 'blue',
      }),
    ),
    tasks: tasks.map(
      (t): TaskRow => ({
        id: t.id,
        title: t.title,
        notes: t.notes,
        projectId: t.projectId,
        status: t.status,
        priority: t.priority,
        startDate: t.startDate ? dayOf(t.startDate) : null,
        dueDate: t.dueDate ? dayOf(t.dueDate) : null,
        assigneeIds: t.assignees.map((a) => a.userId),
        createdByName: t.createdBy?.name ?? null,
        createdAt: t.createdAt.toISOString(),
      }),
    ),
    people: people.map(
      (p): TaskPerson => ({ id: p.id, name: p.name, jobTitle: p.jobTitle, photoUrl: personPhotoUrl(p) }),
    ),
  };
}

/** A task as stored, for a route about to change it. */
export async function loadTaskFacts(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, status: true, startDate: true, dueDate: true, assignees: { select: { userId: true } } },
  });
  if (!task) throw new NotFoundError('Task not found.');
  return { ...task, assigneeIds: task.assignees.map((a) => a.userId) };
}

/** Every id must be a real person; a made-up one would otherwise surface as a vague foreign-key error. */
export async function assertPeopleExist(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const found = await prisma.user.count({ where: { id: { in: unique } } });
  if (found !== unique.length) {
    throw new z.ZodError([{ code: 'custom', path: ['assigneeIds'], message: 'One of those people no longer exists.' }]);
  }
  return unique;
}

export async function assertProjectExists(id: string | null | undefined) {
  if (!id) return;
  const found = await prisma.project.count({ where: { id } });
  if (!found) throw new z.ZodError([{ code: 'custom', path: ['projectId'], message: 'That project no longer exists.' }]);
}
