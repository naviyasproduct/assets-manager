import { prisma } from '@/lib/db';
import { departmentScopeFilter, seesAllDepartments } from '@/lib/auth';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { loadDepartmentOptions, loadLocationOptions } from '@/lib/queries';
import type { MachineSummary } from '@/lib/machine-types';
import { MachineList } from '@/components/MachineList';

export const dynamic = 'force-dynamic';

export default async function MachinesPage() {
  const user = await requirePageAccess('machines', 'VIEW');

  const [machines, departments, locations] = await Promise.all([
    prisma.machine.findMany({
      where: departmentScopeFilter(user),
      orderBy: [{ name: 'asc' }],
      include: {
        department: { select: { name: true } },
        location: { select: { name: true } },
        photos: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } },
        _count: { select: { fixes: true } },
        fixes: { orderBy: { version: 'desc' }, take: 1, select: { fixedAt: true } },
      },
    }),
    loadDepartmentOptions(user),
    loadLocationOptions(),
  ]);

  const rows: MachineSummary[] = machines.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    model: m.model,
    manufacturer: m.manufacturer,
    status: m.status,
    departmentName: m.department.name,
    locationName: m.location?.name ?? null,
    photos: m.photos.map((p) => ({ id: p.id, url: `/api/machines/${m.id}/photos/${p.id}` })),
    version: m.lastVersion,
    repairCount: m._count.fixes,
    lastRepairAt: m.fixes[0]?.fixedAt.toISOString() ?? null,
  }));

  return (
    <MachineList
      machines={rows}
      departments={departments}
      locations={locations}
      canEdit={can(user.access, 'machines', 'EDIT')}
      showDepartment={seesAllDepartments(user)}
      defaultDepartmentId={user.departmentId}
    />
  );
}
