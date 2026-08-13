import { requireUser } from '@/lib/auth';
import { loadDepartmentOptions } from '@/lib/queries';
import { isPublicVideoAccessConfigured } from '@/lib/config';
import { ReportBuilder } from '@/components/ReportBuilder';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string }>;
}) {
  const user = await requireUser();
  const { departmentId } = await searchParams;
  const departments = await loadDepartmentOptions(user);

  const isAdmin = user.role === 'ADMIN';

  const initialDepartmentId =
    departmentId && departments.some((d) => d.id === departmentId)
      ? departmentId
      : isAdmin
        ? 'ALL'
        : (departments[0]?.id ?? '');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>
            Generates a PDF of what each department owns, its condition, and the purchases waiting
            on a decision - ready to hand to the CEO.
          </p>
        </div>
      </div>

      <ReportBuilder
        departments={departments}
        isAdmin={isAdmin}
        initialDepartmentId={initialDepartmentId}
        videoLinksArePublic={isPublicVideoAccessConfigured()}
      />
    </>
  );
}
