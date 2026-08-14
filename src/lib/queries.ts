import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { decimalToNumber } from '@/lib/serialize';
import type {
  AssetRow,
  DepartmentOption,
  AssetCategoryOption,
} from '@/components/AssetManager';
import type { SessionUser } from '@/lib/auth';
import { departmentScopeFilter } from '@/lib/auth';

/**
 * Shared reads for the page components.
 *
 * Server components query Prisma directly rather than calling our own API over
 * HTTP - same process, same authorisation checks, one less round trip. The API
 * routes exist for the browser's mutations.
 */

const assetInclude = {
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, code: true } },
  _count: { select: { fixes: true } },
} satisfies Prisma.AssetInclude;

type AssetWithRelations = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;

/** Prisma row -> the plain, JSON-safe shape the client table expects. */
export function toAssetRow(asset: AssetWithRelations): AssetRow {
  return {
    id: asset.id,
    assetTag: asset.assetTag,
    name: asset.name,
    categoryId: asset.categoryId,
    category: asset.category.name,
    categoryCode: asset.category.code,
    createdAt: asset.createdAt.toISOString(),
    serialNumber: asset.serialNumber,
    location: asset.location,
    status: asset.status,
    purchaseDate: asset.purchaseDate ? asset.purchaseDate.toISOString() : null,
    purchaseCost: decimalToNumber(asset.purchaseCost),
    notes: asset.notes,
    departmentId: asset.departmentId,
    departmentName: asset.department.name,
    fixCount: asset._count.fixes,
    // The upload timestamp is appended as a cache-buster so a replaced photo
    // shows immediately instead of the browser reusing the cached one.
    photoUrl: asset.photoRelativePath
      ? `/api/assets/${asset.id}/photo?v=${asset.photoUploadedAt?.getTime() ?? 0}`
      : null,
  };
}

export async function loadAssets(
  user: SessionUser,
  extraWhere: Prisma.AssetWhereInput = {},
): Promise<AssetRow[]> {
  const assets = await prisma.asset.findMany({
    where: { ...departmentScopeFilter(user), ...extraWhere },
    orderBy: [{ department: { name: 'asc' } }, { assetTag: 'asc' }],
    include: assetInclude,
  });

  return assets.map(toAssetRow);
}

/** Departments the user may file records against. */
export async function loadDepartmentOptions(user: SessionUser): Promise<DepartmentOption[]> {
  const departments = await prisma.department.findMany({
    where:
      user.role === 'ADMIN'
        ? { isActive: true }
        : { id: user.departmentId ?? '__none__' },
    orderBy: { name: 'asc' },
    // The code comes along because the add-asset form previews the tag an asset
    // is about to be given, e.g. WRK-NUT-004.
    select: { id: true, name: true, code: true },
  });

  return departments;
}

/**
 * Categories the user may file assets under.
 *
 * Inactive ones are included: an asset already sitting in a retired category has
 * to keep showing it while being edited. The form is what hides them from the
 * list of things you can newly pick.
 */
export async function loadAssetCategoryOptions(
  user: SessionUser,
): Promise<AssetCategoryOption[]> {
  return prisma.assetCategory.findMany({
    where: departmentScopeFilter(user),
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true, departmentId: true, isActive: true },
  });
}
