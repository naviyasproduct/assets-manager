import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { NewDepartmentForm } from '@/components/NewDepartmentForm';

export const dynamic = 'force-dynamic';

/**
 * Reached from the "+ Create department" row in the add-asset form, and from the
 * departments list. `next` is where to go afterwards; it is checked here rather
 * than trusted, so the parameter cannot be used to bounce someone off-site.
 */
export default async function NewDepartmentPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== 'ADMIN') redirect('/departments');

  const { next } = await searchParams;

  const isInternalPath = Boolean(next && next.startsWith('/') && !next.startsWith('//'));
  const returnTo = isInternalPath ? next! : '/departments';
  const cameFromAssetForm = isInternalPath && next !== '/departments';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>New department</h1>
          <p>
            {cameFromAssetForm
              ? 'Create the department, and you will be taken straight back to the asset you were adding.'
              : 'A department owns its own assets, categories and purchase requests.'}
          </p>
        </div>
      </div>

      <NewDepartmentForm
        returnTo={returnTo}
        returnLabel={cameFromAssetForm ? 'Back to the form' : 'Back to departments'}
      />
    </>
  );
}
