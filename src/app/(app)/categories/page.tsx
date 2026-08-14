import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { AssetCategoryManager } from '@/components/AssetCategoryManager';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const user = await requireUser();
  const isAdmin = user.role === 'ADMIN';

  // A department head only ever sees their own department here, the same way
  // they only ever see their own assets.
  const departments = await prisma.department.findMany({
    where: isAdmin ? {} : { id: user.departmentId ?? '__none__' },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      assetCategories: {
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { assets: true } } },
      },
    },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <p>
            The groups a department sorts its equipment into. A category&rsquo;s code becomes the
            middle of every asset tag it issues, so a label reads department, group, then number.
          </p>
        </div>
      </div>

      <AssetCategoryManager
        canAddDepartment={isAdmin}
        groups={departments.map((department) => ({
          id: department.id,
          name: department.name,
          code: department.code,
          isActive: department.isActive,
          categories: department.assetCategories.map((category) => ({
            id: category.id,
            name: category.name,
            code: category.code,
            description: category.description,
            isActive: category.isActive,
            assetCount: category._count.assets,
          })),
        }))}
      />
    </>
  );
}
