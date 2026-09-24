import { prisma } from '@/lib/db';
import { requirePageAccess } from '@/lib/page-auth';
import { resolveAccess } from '@/lib/permissions';
import { EmployeeManager, type EmployeeRow } from '@/components/EmployeeManager';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const user = await requirePageAccess('employees', 'VIEW');
  const isAdmin = user.role === 'ADMIN';

  const [people, departments] = await Promise.all([
    prisma.user.findMany({
      // The directory is for finding someone to call; a deactivated account is
      // only the admin's business.
      where: isAdmin ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        jobTitle: true,
        phone: true,
        allDepartments: true,
        mustChangePassword: true,
        lastLoginAt: true,
        permissions: true,
        photoRelativePath: true,
        photoUploadedAt: true,
        department: { select: { id: true, name: true } },
      },
    }),
    prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const rows: EmployeeRow[] = people.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    isActive: person.isActive,
    jobTitle: person.jobTitle,
    phone: person.phone,
    allDepartments: person.allDepartments,
    departmentId: person.department?.id ?? null,
    departmentName: person.department?.name ?? null,
    photoUrl: person.photoRelativePath
      ? `/api/users/${person.id}/photo?v=${person.photoUploadedAt?.getTime() ?? 0}`
      : null,
    account: isAdmin
      ? {
          mustChangePassword: person.mustChangePassword,
          lastLoginAt: person.lastLoginAt ? person.lastLoginAt.toISOString() : null,
          access: resolveAccess(person.role, person.permissions),
        }
      : null,
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Employees</h1>
          <p>
            {isAdmin
              ? 'Everyone who signs in. Their role sets what they can open to begin with, and any single area can then be opened up or closed off for that one person.'
              : 'The people here and how to reach them.'}
          </p>
        </div>
      </div>

      <EmployeeManager
        employees={rows}
        departments={departments}
        currentUserId={user.id}
        isAdmin={isAdmin}
      />
    </>
  );
}
