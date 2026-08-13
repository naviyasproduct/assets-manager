import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { UserManager, type UserRow } from '@/components/UserManager';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') notFound();

  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        department: { select: { id: true, name: true } },
      },
    }),
    prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows: UserRow[] = users.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    departmentId: row.department?.id ?? null,
    departmentName: row.department?.name ?? null,
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>
            Accounts are created here - there is no self sign-up. A department head only ever sees
            their own department.
          </p>
        </div>
      </div>

      <UserManager users={rows} departments={departments} currentUserId={user.id} />
    </>
  );
}
