import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { loadTaskBoard } from '@/lib/tasks';
import { TaskManager } from '@/components/TaskManager';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const user = await requirePageAccess('tasks', 'VIEW');
  const board = await loadTaskBoard();

  return (
    <TaskManager
      projects={board.projects}
      tasks={board.tasks}
      people={board.people}
      ability={{ edit: can(user.access, 'tasks', 'EDIT'), userId: user.id }}
    />
  );
}
