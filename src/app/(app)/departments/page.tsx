import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { seesAllDepartments } from '@/lib/auth';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { DepartmentManager } from '@/components/DepartmentManager';

export const dynamic = 'force-dynamic';

export default async function DepartmentsPage() {
  const user = await requirePageAccess('departments', 'VIEW');

  // Someone scoped to one department would see a list of one row, so send them
  // straight into it.
  if (!seesAllDepartments(user)) {
    redirect(user.departmentId ? `/departments/${user.departmentId}` : '/');
  }

  const departments = await prisma.department.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { assets: true, purchaseOrders: true, users: true } },
    },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Departments</h1>
          <p>Each department owns its own assets and purchase orders.</p>
        </div>
      </div>

      <DepartmentManager
        canEdit={can(user.access, 'departments', 'EDIT')}
        departments={departments.map((d) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          description: d.description,
          location: d.location,
          isActive: d.isActive,
          assetCount: d._count.assets,
          orderCount: d._count.purchaseOrders,
          userCount: d._count.users,
        }))}
      />
    </>
  );
}
