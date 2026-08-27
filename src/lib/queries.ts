import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { decimalToNumber } from '@/lib/serialize';
import type {
  AssetRow,
  DepartmentOption,
  AssetCategoryOption,
  LocationOption,
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
  location: { select: { id: true, name: true } },
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
    locationId: asset.locationId,
    locationName: asset.location?.name ?? null,
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

/**
 * Places an asset can be put.
 *
 * Not scoped by department, unlike the two above: a location belongs to the site
 * rather than to anyone, and a department head has to be able to say their
 * machine is in the same shed as everyone else's. Retired ones come along for
 * the same reason categories do - an asset still standing in one has to keep
 * showing it while being edited.
 */
export async function loadLocationOptions(): Promise<LocationOption[]> {
  return prisma.location.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, isActive: true },
  });
}

// ---------------------------------------------------------------------------
// Saved report setups
// ---------------------------------------------------------------------------

/**
 * The shape a saved report is read in, shared by the reports page and the three
 * API routes so the browser always receives the same object.
 */
export const REPORT_PRESET_SELECT = {
  id: true,
  name: true,
  description: true,
  config: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
} as const;

/**
 * Every saved report, for everyone.
 *
 * Not scoped by department, unlike the reads above: a setup is a way of laying
 * a document out, not the data in it, and the scope of the report it produces
 * is applied when it runs. A department head opening a company-wide setup gets
 * their own department's rows and nobody else's.
 */
export async function loadReportPresets() {
  return prisma.reportPreset.findMany({
    orderBy: { name: 'asc' },
    select: REPORT_PRESET_SELECT,
  });
}
