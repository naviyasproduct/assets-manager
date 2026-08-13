import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { DepartmentManager } from '@/components/DepartmentManager';

export const dynamic = 'force-dynamic';

export default async function DepartmentsPage() {
  const user = await requireUser();

  // A department head has exactly one department; the list view would just be a
  // single row, so send them straight into it.
  if (user.role !== 'ADMIN') {
    redirect(user.departmentId ? `/departments/${user.departmentId}` : '/');
  }

  const departments = await prisma.department.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { assets: true, purchaseRequests: true, users: true } },
    },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Departments</h1>
          <p>Each department owns its own assets and purchase requests.</p>
        </div>
      </div>

      <DepartmentManager
        departments={departments.map((d) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          description: d.description,
          location: d.location,
          isActive: d.isActive,
          assetCount: d._count.assets,
          requestCount: d._count.purchaseRequests,
          userCount: d._count.users,
        }))}
      />
    </>
  );
}
