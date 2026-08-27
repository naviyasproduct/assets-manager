import { requireUser } from '@/lib/auth';
import {
  loadDepartmentOptions,
  loadAssetCategoryOptions,
  loadLocationOptions,
  loadReportPresets,
} from '@/lib/queries';
import { isPublicVideoAccessConfigured } from '@/lib/config';
import { ReportBuilder, type SavedReport } from '@/components/ReportBuilder';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string; from?: string }>;
}) {
  const user = await requireUser();
  const { departmentId, from } = await searchParams;

  const [departments, categories, locations, presets] = await Promise.all([
    loadDepartmentOptions(user),
    loadAssetCategoryOptions(user),
    loadLocationOptions(),
    loadReportPresets(),
  ]);

  // Arriving from a department's own page opens the builder already narrowed to
  // it, which is what the link on that page means.
  const initialDepartmentIds =
    departmentId && departments.some((d) => d.id === departmentId) ? [departmentId] : [];

  const savedReports: SavedReport[] = presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    config: preset.config,
    createdById: preset.createdById,
    authorName: preset.createdBy?.name ?? null,
    updatedAt: preset.updatedAt.toISOString(),
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>
            Lay the page out on the page itself. Click any block for its handles - drag it
            somewhere else, take it off, or open it to change what it shows - and the tools above
            cover everything the document is built from.
          </p>
        </div>
      </div>

      <ReportBuilder
        isAdmin={user.role === 'ADMIN'}
        fromSelection={from === 'selection'}
        currentUserId={user.id}
        departments={departments}
        categories={categories}
        locations={locations}
        savedReports={savedReports}
        initialDepartmentIds={initialDepartmentIds}
        videoLinksArePublic={isPublicVideoAccessConfigured()}
      />
    </>
  );
}
