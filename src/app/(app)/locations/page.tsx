import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { LocationManager, type LocationRow } from '@/components/LocationManager';

export const dynamic = 'force-dynamic';

export default async function LocationsPage() {
  const user = await requireUser();

  // Only an admin may add or edit one, so for anyone else this screen would be a
  // read-only list they cannot act on. The assets table already filters by
  // location, which is the part a department head actually needs.
  if (user.role !== 'ADMIN') redirect('/assets');

  const locations = await prisma.location.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      assets: {
        select: { departmentId: true, department: { select: { name: true } } },
      },
    },
  });

  const rows: LocationRow[] = locations.map((location) => {
    // Counted here rather than with a grouped query: the asset rows are already
    // loaded, and a site this size has far fewer assets than the round trip
    // would cost.
    const byDepartment = new Map<string, { id: string; name: string; assetCount: number }>();

    for (const asset of location.assets) {
      const entry = byDepartment.get(asset.departmentId);
      if (entry) entry.assetCount += 1;
      else {
        byDepartment.set(asset.departmentId, {
          id: asset.departmentId,
          name: asset.department.name,
          assetCount: 1,
        });
      }
    }

    return {
      id: location.id,
      name: location.name,
      description: location.description,
      isActive: location.isActive,
      assetCount: location.assets.length,
      departments: [...byDepartment.values()].sort(
        (a, b) => b.assetCount - a.assetCount || a.name.localeCompare(b.name),
      ),
    };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Locations</h1>
          <p>
            The physical places equipment stands. Unlike categories these belong to the site rather
            than to a department, so one bay can hold machines from several at once.
          </p>
        </div>
      </div>

      <LocationManager locations={rows} />
    </>
  );
}
