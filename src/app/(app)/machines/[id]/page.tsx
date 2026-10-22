import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { canAccessDepartment } from '@/lib/auth';
import { requirePageAccess } from '@/lib/page-auth';
import { can } from '@/lib/permissions';
import { buildVideoWatchUrl, isPublicVideoAccessConfigured } from '@/lib/config';
import { bigIntToNumber } from '@/lib/serialize';
import { loadDepartmentOptions, loadLocationOptions } from '@/lib/queries';
import type { FixPerson, FixRow, MachineDetail } from '@/lib/machine-types';
import { MachineProfile } from '@/components/MachineProfile';

export const dynamic = 'force-dynamic';

export default async function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess('machines', 'VIEW');

  const machine = await prisma.machine.findUnique({
    where: { id },
    include: {
      department: { select: { name: true } },
      location: { select: { name: true } },
      createdBy: { select: { name: true } },
      photos: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } },
      fixes: {
        orderBy: { version: 'desc' },
        include: {
          recordedBy: { select: { name: true } },
          fixedBy: { select: { name: true } },
          files: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  if (!machine || !canAccessDepartment(user, machine.departmentId)) notFound();

  const [departments, locations, people] = await Promise.all([
    loadDepartmentOptions(user),
    loadLocationOptions(),
    // Everyone, signed-in or not: most of the people who fix machines have no
    // login, and those records are kept deactivated (see api/machines/people).
    prisma.user.findMany({
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, role: true, jobTitle: true },
    }),
  ]);

  const detail: MachineDetail = {
    id: machine.id,
    code: machine.code,
    name: machine.name,
    model: machine.model,
    manufacturer: machine.manufacturer,
    serialNumber: machine.serialNumber,
    status: machine.status,
    departmentId: machine.departmentId,
    departmentName: machine.department.name,
    locationId: machine.locationId,
    locationName: machine.location?.name ?? null,
    installedAt: machine.installedAt?.toISOString() ?? null,
    notes: machine.notes,
    photos: machine.photos.map((p) => ({ id: p.id, url: `/api/machines/${machine.id}/photos/${p.id}` })),
    version: machine.lastVersion,
    repairCount: machine.fixes.length,
    lastRepairAt: machine.fixes[0]?.fixedAt.toISOString() ?? null,
    createdByName: machine.createdBy?.name ?? null,
    createdAt: machine.createdAt.toISOString(),
  };

  const fixes: FixRow[] = machine.fixes.map((fix) => ({
    id: fix.id,
    version: fix.version,
    title: fix.title,
    symptom: fix.symptom,
    description: fix.description,
    fixedById: fix.fixedById,
    // Linked, the person reads as they are named now; the copy is for after they are gone.
    fixedByName: fix.fixedBy?.name ?? fix.fixedByName,
    fixedAt: fix.fixedAt.toISOString(),
    statusAfter: fix.statusAfter,
    recordedByName: fix.recordedBy.name,
    files: fix.files.map((file) => ({
      id: file.id,
      kind: file.kind,
      fileName: file.fileName,
      sizeBytes: bigIntToNumber(file.sizeBytes) ?? 0,
      url: `/api/machines/${machine.id}/files/${file.id}`,
      watchUrl: file.token ? buildVideoWatchUrl(file.token) : null,
    })),
  }));

  return (
    <MachineProfile
      machine={detail}
      fixes={fixes}
      people={people satisfies FixPerson[]}
      departments={departments}
      locations={locations}
      canEdit={can(user.access, 'machines', 'EDIT')}
      linksArePublic={isPublicVideoAccessConfigured()}
    />
  );
}
