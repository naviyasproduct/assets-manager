import 'server-only';
import type { AssetStatus, PurchasePriority, PurchaseStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config as appConfig, buildVideoWatchUrl, isPublicVideoAccessConfigured } from '@/lib/config';
import { readImageAsDataUri } from '@/lib/image-storage';
import { decimalToNumber } from '@/lib/serialize';
import { ASSET_STATUS_LABELS, ASSET_STATUS_ORDER } from '@/lib/format';
import { AuthError, type SessionUser } from '@/lib/auth';
import type { z } from 'zod';
import type { reportRequestSchema } from '@/lib/validation';
import {
  NO_LOCATION,
  enabledSections,
  fixesCanGroupBy,
  normalizeReportConfig,
  purchasesCanGroupBy,
  sectionIsOn,
  type NormalizedReportConfig,
  type ReportGroupBy,
} from '@/lib/reports/config';

export type ReportRequest = z.infer<typeof reportRequestSchema>;

export type StatusCounts = Record<AssetStatus, number>;

export type ReportAssetRow = {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  categoryId: string;
  department: string;
  departmentId: string;
  departmentCode: string;
  serialNumber: string | null;
  location: string | null;
  locationId: string | null;
  status: AssetStatus;
  purchaseDate: Date | null;
  purchaseCost: number | null;
  notes: string | null;
  fixCount: number;
  /** base64 data URI, or null. Inlined so the PDF needs no network. */
  photoDataUri: string | null;
};

export type ReportPurchaseRow = {
  id: string;
  title: string;
  category: string;
  department: string;
  departmentId: string;
  kind: 'NEW' | 'REPLACEMENT';
  quantity: number;
  estimatedCost: number | null;
  lineTotal: number | null;
  justification: string;
  priority: PurchasePriority;
  status: PurchaseStatus;
  requestedByName: string;
  requestedAt: Date;
  replacesAssetTag: string | null;
  replacesAssetName: string | null;
};

export type ReportFixRow = {
  id: string;
  title: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  department: string;
  departmentId: string;
  fixedByName: string;
  fixedAt: Date;
  symptom: string | null;
  videoUrl: string | null;
};

/**
 * One block of the document.
 *
 * What a group *is* depends on `groupBy` - a department, a shed, a category or
 * a condition - which is why nothing here is named after a department any more.
 */
export type ReportGroup = {
  key: string;
  label: string;
  /** The department code chip. Only groups that are departments have one. */
  code: string | null;
  description: string | null;
  subtitle: string | null;
  assetCount: number;
  statusCounts: StatusCounts;
  knownValue: number;
  assetsWithUnknownCost: number;
  assets: ReportAssetRow[];
  purchases: ReportPurchaseRow[];
  pendingPurchaseCount: number;
  pendingPurchaseEstimate: number;
  fixes: ReportFixRow[];
};

export type ReportTotals = {
  groupCount: number;
  departmentCount: number;
  assetCount: number;
  statusCounts: StatusCounts;
  knownValue: number;
  assetsWithUnknownCost: number;
  pendingPurchaseCount: number;
  pendingPurchaseEstimate: number;
  approvedPurchaseCount: number;
  approvedPurchaseEstimate: number;
  purchaseCount: number;
  fixCount: number;
  videoCount: number;
};

export type ReportData = {
  meta: {
    companyName: string;
    tagline: string;
    title: string;
    scopeLabel: string;
    groupByLabel: string;
    generatedAt: Date;
    generatedByName: string;
    generatedByRole: string;
    /** False when no Cloudflare Tunnel is set up - video links are LAN-only. */
    videoLinksArePublic: boolean;
    config: NormalizedReportConfig;
    /** Anything the setup had to be corrected for, shown above the preview. */
    warnings: string[];
    /** Rendered into the page for the on-screen preview, not for the PDF. */
    isPreview: boolean;
    /**
     * The preview is being laid out by hand, so the document carries the
     * handles and the script the canvas needs. Never true for the PDF.
     */
    editable: boolean;
  };
  totals: ReportTotals;
  groups: ReportGroup[];
  /**
   * Rows that the current grouping cannot place - purchase requests when the
   * report is grouped by anything but department, and repairs when it is
   * grouped by condition. Rendered once, after the groups.
   */
  ungrouped: {
    purchases: ReportPurchaseRow[];
    fixes: ReportFixRow[];
  };
  /** Attention list, most urgent first. */
  attention: ReportAssetRow[];
};

/** The tick lists in the builder: every row that matched, before exclusions. */
export type ReportCandidates = {
  assets: Array<{ id: string; label: string; sub: string; group: string; status: AssetStatus }>;
  purchases: Array<{ id: string; label: string; sub: string; group: string }>;
  fixes: Array<{ id: string; label: string; sub: string; group: string }>;
};

function emptyStatusCounts(): StatusCounts {
  return { IN_USE: 0, IDLE: 0, NEEDS_REPLACEMENT: 0, BROKEN: 0 };
}

/** Broken and needs-replacement float to the top - that is what the CEO acts on. */
const STATUS_SEVERITY: Record<AssetStatus, number> = {
  BROKEN: 0,
  NEEDS_REPLACEMENT: 1,
  IDLE: 2,
  IN_USE: 3,
};

const PRIORITY_SEVERITY: Record<PurchasePriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const GROUP_BY_NOUN: Record<ReportGroupBy, string> = {
  DEPARTMENT: 'department',
  LOCATION: 'location',
  CATEGORY: 'category',
  STATUS: 'condition',
  NONE: 'nothing',
};

/** Repairs are capped so one machine with a long history cannot swamp a report. */
const FIX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * The departments this report covers.
 *
 * A department head asking for someone else's department is refused rather than
 * quietly narrowed - the same rule the old report had, and the reason is
 * unchanged: nobody should be handed a document believing it covers more than
 * it does. The builder never sends one, because its picker only ever lists
 * departments the person may see.
 */
async function resolveDepartments(user: SessionUser, config: NormalizedReportConfig) {
  const requested = config.departmentIds;

  if (user.role !== 'ADMIN') {
    if (!user.departmentId) {
      throw new AuthError('Your account is not assigned to a department.', 403);
    }
    const foreign = requested.find((id) => id !== user.departmentId);
    if (foreign) {
      throw new AuthError('You do not have access to that department.', 403);
    }
  }

  const where: Prisma.DepartmentWhereInput =
    requested.length > 0
      ? { id: { in: requested } }
      : user.role === 'ADMIN'
        ? { isActive: true }
        : { id: user.departmentId ?? '__none__' };

  const departments = await prisma.department.findMany({
    where,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true, description: true, location: true },
  });

  if (departments.length === 0) {
    throw new Error('No departments matched this report.');
  }

  return departments;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function assetWhereFor(
  config: NormalizedReportConfig,
  departmentIds: string[],
  includeAssetIds: string[],
): Prisma.AssetWhereInput {
  const and: Prisma.AssetWhereInput[] = [];

  // A hand-picked set from the Assets screen. It narrows on top of everything
  // else rather than replacing it, so the department scope still applies - a
  // department head cannot widen their reach by sending ids.
  if (includeAssetIds.length > 0) and.push({ id: { in: includeAssetIds } });

  if (config.statuses.length > 0) and.push({ status: { in: config.statuses } });
  if (config.categoryIds.length > 0) and.push({ categoryId: { in: config.categoryIds } });

  // 'NONE' is how the builder asks for machines with no place written down.
  const locationIds = config.locationIds.filter((id) => id !== NO_LOCATION);
  const wantsUnplaced = config.locationIds.includes(NO_LOCATION);

  if (locationIds.length > 0 && wantsUnplaced) {
    and.push({ OR: [{ locationId: { in: locationIds } }, { locationId: null }] });
  } else if (locationIds.length > 0) {
    and.push({ locationId: { in: locationIds } });
  } else if (wantsUnplaced) {
    and.push({ locationId: null });
  }

  const search = config.search?.trim();
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { assetTag: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { category: { name: { contains: search, mode: 'insensitive' } } },
        { location: { name: { contains: search, mode: 'insensitive' } } },
      ],
    });
  }

  return { departmentId: { in: departmentIds }, ...(and.length > 0 ? { AND: and } : {}) };
}

function purchaseWhereFor(
  config: NormalizedReportConfig,
  departmentIds: string[],
): Prisma.PurchaseRequestWhereInput {
  const and: Prisma.PurchaseRequestWhereInput[] = [];

  // An empty list means "no filter" here as everywhere else in the config.
  if (config.purchaseStatuses.length > 0) and.push({ status: { in: config.purchaseStatuses } });
  if (config.purchasePriorities.length > 0) {
    and.push({ priority: { in: config.purchasePriorities } });
  }

  const search = config.search?.trim();
  if (search) {
    and.push({
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { justification: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  return { departmentId: { in: departmentIds }, ...(and.length > 0 ? { AND: and } : {}) };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

function newGroup(key: string, label: string, extra: Partial<ReportGroup> = {}): ReportGroup {
  return {
    key,
    label,
    code: null,
    description: null,
    subtitle: null,
    assetCount: 0,
    statusCounts: emptyStatusCounts(),
    knownValue: 0,
    assetsWithUnknownCost: 0,
    assets: [],
    purchases: [],
    pendingPurchaseCount: 0,
    pendingPurchaseEstimate: 0,
    fixes: [],
    ...extra,
  };
}

const UNGROUPED_KEY = '__ungrouped__';

function assetGroupKey(asset: ReportAssetRow, groupBy: ReportGroupBy): string {
  switch (groupBy) {
    case 'DEPARTMENT':
      return asset.departmentId;
    case 'LOCATION':
      return asset.locationId ?? UNGROUPED_KEY;
    case 'CATEGORY':
      return asset.categoryId;
    case 'STATUS':
      return asset.status;
    case 'NONE':
      return 'ALL';
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Gathers everything the template needs, in one pass, for any setup.
 *
 * The shape of the work: resolve the scope, pull the three record types the
 * filters allow, drop the rows ticked off by hand, then arrange what is left
 * into groups the chosen `groupBy` decides. Photos are read last, in parallel,
 * and only when a table actually shows them.
 */
export async function buildReportData(
  user: SessionUser,
  request: ReportRequest,
  options: { preview?: boolean; editable?: boolean } = {},
): Promise<{ data: ReportData; candidates: ReportCandidates }> {
  const { config, warnings } = normalizeReportConfig(request.config);
  const isPreview = options.preview === true;
  // Guarded on isPreview as well, so no caller can ever ask for a PDF with the
  // editing handles baked into it.
  const editable = isPreview && options.editable === true;

  const departments = await resolveDepartments(user, config);
  const departmentIds = departments.map((d) => d.id);
  const departmentById = new Map(departments.map((d) => [d.id, d]));

  const showAssets = sectionIsOn(config, 'ASSETS') || sectionIsOn(config, 'ATTENTION');
  const showPurchases = sectionIsOn(config, 'PURCHASES');
  const showFixes = sectionIsOn(config, 'FIXES');

  const assetWhere = assetWhereFor(config, departmentIds, request.includeAssetIds);

  // The summary counts assets whether or not the asset table is switched on, so
  // the rows are always fetched. They are cheap next to the photos, which are
  // not read at all unless a table shows them.
  const [assetRecords, purchaseRecords, fixRecords] = await Promise.all([
    prisma.asset.findMany({
      where: assetWhere,
      include: {
        category: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        department: { select: { id: true, name: true, code: true } },
        _count: { select: { fixes: true } },
      },
    }),
    showPurchases
      ? prisma.purchaseRequest.findMany({
          where: purchaseWhereFor(config, departmentIds),
          include: {
            department: { select: { id: true, name: true } },
            requestedBy: { select: { name: true } },
            replacesAsset: { select: { assetTag: true, name: true } },
          },
        })
      : Promise.resolve([]),
    showFixes
      ? prisma.machineFix.findMany({
          // Repairs follow their asset: whatever the filters left in the report
          // is what the history covers.
          where: {
            asset: assetWhere,
            ...(config.fixesRequireVideo ? { videoToken: { not: null } } : {}),
          },
          orderBy: { fixedAt: 'desc' },
          take: FIX_LIMIT,
          include: {
            asset: {
              select: {
                id: true,
                assetTag: true,
                name: true,
                departmentId: true,
                locationId: true,
                categoryId: true,
                status: true,
                department: { select: { name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  // --- Rows ---------------------------------------------------------------

  const photoPaths = new Map<string, string>();

  const allAssets: ReportAssetRow[] = assetRecords.map((asset) => {
    if (asset.photoRelativePath) photoPaths.set(asset.id, asset.photoRelativePath);
    return {
      id: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      category: asset.category.name,
      categoryId: asset.category.id,
      department: asset.department.name,
      departmentId: asset.department.id,
      departmentCode: asset.department.code,
      serialNumber: asset.serialNumber,
      location: asset.location?.name ?? null,
      locationId: asset.location?.id ?? null,
      status: asset.status,
      purchaseDate: asset.purchaseDate,
      purchaseCost: decimalToNumber(asset.purchaseCost),
      notes: asset.notes,
      fixCount: asset._count.fixes,
      photoDataUri: null,
    };
  });

  let allPurchases: ReportPurchaseRow[] = purchaseRecords.map((request_) => {
    const unitCost = decimalToNumber(request_.estimatedCost);
    return {
      id: request_.id,
      title: request_.title,
      category: request_.category,
      department: request_.department.name,
      departmentId: request_.department.id,
      kind: request_.kind,
      quantity: request_.quantity,
      estimatedCost: unitCost,
      lineTotal: unitCost === null ? null : unitCost * request_.quantity,
      justification: request_.justification,
      priority: request_.priority,
      status: request_.status,
      requestedByName: request_.requestedBy.name,
      requestedAt: request_.createdAt,
      replacesAssetTag: request_.replacesAsset?.assetTag ?? null,
      replacesAssetName: request_.replacesAsset?.name ?? null,
    };
  });

  const allFixes: ReportFixRow[] = fixRecords.map((fix) => ({
    id: fix.id,
    title: fix.title,
    assetId: fix.asset.id,
    assetTag: fix.asset.assetTag,
    assetName: fix.asset.name,
    department: fix.asset.department.name,
    departmentId: fix.asset.departmentId,
    fixedByName: fix.fixedByName,
    fixedAt: fix.fixedAt,
    symptom: fix.symptom,
    videoUrl: fix.videoToken ? buildVideoWatchUrl(fix.videoToken) : null,
  }));

  // A hand-picked set of assets makes the report about those machines. Without
  // this, picking three IT assets still produced a Printing section and a
  // Workshop section - empty of equipment, but each carrying that department's
  // purchase requests, which reads as a mistake. Narrowing here rather than in
  // the query keeps it to one round trip; there are never many requests.
  const pickedAssets = request.includeAssetIds.length > 0;
  const departmentsWithAssets = new Set(allAssets.map((asset) => asset.departmentId));

  if (pickedAssets) {
    allPurchases = allPurchases.filter((purchase) =>
      departmentsWithAssets.has(purchase.departmentId),
    );
  }

  // --- The tick lists, before anything is excluded ------------------------

  const groupLabelForAsset = (asset: ReportAssetRow): string => {
    switch (config.groupBy) {
      case 'LOCATION':
        return asset.location ?? 'No location set';
      case 'CATEGORY':
        return asset.category;
      case 'STATUS':
        return ASSET_STATUS_LABELS[asset.status];
      default:
        return asset.department;
    }
  };

  const candidates: ReportCandidates = {
    assets: allAssets.map((asset) => ({
      id: asset.id,
      label: asset.name,
      sub: asset.assetTag,
      group: groupLabelForAsset(asset),
      status: asset.status,
    })),
    purchases: allPurchases.map((purchase) => ({
      id: purchase.id,
      label: purchase.title,
      sub: `${purchase.department} · ${purchase.quantity} × ${purchase.category}`,
      group: purchase.department,
    })),
    fixes: allFixes.map((fix) => ({
      id: fix.id,
      label: fix.title,
      sub: `${fix.assetTag} · ${fix.assetName}`,
      group: fix.department,
    })),
  };

  // --- Hand-picked exclusions ---------------------------------------------

  const excludedAssets = new Set(request.excludedAssetIds);
  const excludedPurchases = new Set(request.excludedPurchaseIds);
  const excludedFixes = new Set(request.excludedFixIds);

  const assets = allAssets.filter((asset) => !excludedAssets.has(asset.id));
  const purchases = allPurchases.filter((purchase) => !excludedPurchases.has(purchase.id));
  // A repair whose asset was ticked off goes with it: a report that lists a
  // repair to a machine it does not contain reads as a mistake.
  const fixes = allFixes.filter(
    (fix) => !excludedFixes.has(fix.id) && !excludedAssets.has(fix.assetId),
  );

  // --- Groups -------------------------------------------------------------

  const groups = new Map<string, ReportGroup>();

  if (config.groupBy === 'DEPARTMENT' && !pickedAssets) {
    // Seeded from the scope rather than from the rows, so a department with
    // nothing in it still appears and says so. Not when assets were picked by
    // hand: an empty section is noise when the report is about three machines.
    for (const department of departments) {
      groups.set(
        department.id,
        newGroup(department.id, department.name, {
          code: department.code,
          description: department.description,
          subtitle: department.location ? `Location: ${department.location}` : null,
        }),
      );
    }
  } else if (config.groupBy === 'STATUS') {
    const wanted = config.statuses.length > 0 ? config.statuses : ASSET_STATUS_ORDER;
    for (const status of wanted) {
      groups.set(status, newGroup(status, ASSET_STATUS_LABELS[status]));
    }
  } else if (config.groupBy === 'LOCATION' && config.locationIds.length > 0) {
    const named = await prisma.location.findMany({
      where: { id: { in: config.locationIds.filter((id) => id !== NO_LOCATION) } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true },
    });
    for (const location of named) {
      groups.set(
        location.id,
        newGroup(location.id, location.name, { description: location.description }),
      );
    }
    if (config.locationIds.includes(NO_LOCATION)) {
      groups.set(UNGROUPED_KEY, newGroup(UNGROUPED_KEY, 'No location set'));
    }
  } else if (config.groupBy === 'CATEGORY' && config.categoryIds.length > 0) {
    const named = await prisma.assetCategory.findMany({
      where: { id: { in: config.categoryIds } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        department: { select: { name: true } },
      },
    });
    for (const category of named) {
      groups.set(
        category.id,
        newGroup(category.id, category.name, {
          code: category.code,
          description: category.description,
          subtitle: category.department.name,
        }),
      );
    }
  } else if (config.groupBy === 'NONE') {
    groups.set('ALL', newGroup('ALL', 'All records'));
  }

  /** Groups the seeding did not cover - a location that only the data knows. */
  function groupFor(key: string, label: string, extra: Partial<ReportGroup> = {}): ReportGroup {
    const existing = groups.get(key);
    if (existing) return existing;
    const created = newGroup(key, label, extra);
    groups.set(key, created);
    return created;
  }

  for (const asset of assets) {
    const key = assetGroupKey(asset, config.groupBy);
    const group =
      config.groupBy === 'LOCATION'
        ? groupFor(key, asset.location ?? 'No location set')
        : config.groupBy === 'CATEGORY'
          ? groupFor(key, asset.category, { subtitle: asset.department })
          : config.groupBy === 'STATUS'
            ? groupFor(key, ASSET_STATUS_LABELS[asset.status])
            : config.groupBy === 'NONE'
              ? groupFor('ALL', 'All records')
              : groupFor(key, asset.department, { code: asset.departmentCode });

    group.assets.push(asset);
    group.assetCount += 1;
    group.statusCounts[asset.status] += 1;
    if (asset.purchaseCost === null) group.assetsWithUnknownCost += 1;
    else group.knownValue += asset.purchaseCost;
  }

  const ungrouped: ReportData['ungrouped'] = { purchases: [], fixes: [] };

  for (const purchase of purchases) {
    const group = purchasesCanGroupBy(config.groupBy)
      ? groups.get(purchase.departmentId)
      : config.groupBy === 'NONE'
        ? groups.get('ALL')
        : undefined;

    if (!group) {
      ungrouped.purchases.push(purchase);
      continue;
    }
    group.purchases.push(purchase);
    if (purchase.status === 'PENDING') {
      group.pendingPurchaseCount += 1;
      group.pendingPurchaseEstimate += purchase.lineTotal ?? 0;
    }
  }

  for (const fix of fixes) {
    if (!fixesCanGroupBy(config.groupBy)) {
      if (config.groupBy === 'NONE') groups.get('ALL')?.fixes.push(fix);
      else ungrouped.fixes.push(fix);
      continue;
    }

    const record = fixRecords.find((f) => f.id === fix.id);
    const key =
      config.groupBy === 'LOCATION'
        ? (record?.asset.locationId ?? UNGROUPED_KEY)
        : config.groupBy === 'CATEGORY'
          ? (record?.asset.categoryId ?? UNGROUPED_KEY)
          : fix.departmentId;

    const group = groups.get(key);
    if (group) group.fixes.push(fix);
    else ungrouped.fixes.push(fix);
  }

  // --- Sorting ------------------------------------------------------------

  const orderedGroups = [...groups.values()].sort((a, b) => {
    if (config.groupBy === 'STATUS') {
      return (
        STATUS_SEVERITY[a.key as AssetStatus] - STATUS_SEVERITY[b.key as AssetStatus]
      );
    }
    // "No location set" sits at the end rather than sorting under N.
    if (a.key === UNGROUPED_KEY) return 1;
    if (b.key === UNGROUPED_KEY) return -1;
    return a.label.localeCompare(b.label);
  });

  for (const group of orderedGroups) {
    group.assets.sort(
      (a, b) =>
        STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status] ||
        a.assetTag.localeCompare(b.assetTag, undefined, { numeric: true }),
    );
    group.purchases.sort(sortPurchases);
    group.fixes.sort((a, b) => b.fixedAt.getTime() - a.fixedAt.getTime());
  }
  ungrouped.purchases.sort(sortPurchases);
  ungrouped.fixes.sort((a, b) => b.fixedAt.getTime() - a.fixedAt.getTime());

  // --- Totals -------------------------------------------------------------

  const totals: ReportTotals = {
    groupCount: orderedGroups.length,
    departmentCount: new Set(assets.map((a) => a.departmentId)).size || departments.length,
    assetCount: assets.length,
    statusCounts: emptyStatusCounts(),
    knownValue: 0,
    assetsWithUnknownCost: 0,
    pendingPurchaseCount: 0,
    pendingPurchaseEstimate: 0,
    approvedPurchaseCount: 0,
    approvedPurchaseEstimate: 0,
    purchaseCount: purchases.length,
    fixCount: fixes.length,
    videoCount: fixes.filter((fix) => fix.videoUrl).length,
  };

  for (const asset of assets) {
    totals.statusCounts[asset.status] += 1;
    if (asset.purchaseCost === null) totals.assetsWithUnknownCost += 1;
    else totals.knownValue += asset.purchaseCost;
  }

  for (const purchase of purchases) {
    if (purchase.status === 'PENDING') {
      totals.pendingPurchaseCount += 1;
      totals.pendingPurchaseEstimate += purchase.lineTotal ?? 0;
    } else if (purchase.status === 'APPROVED') {
      totals.approvedPurchaseCount += 1;
      totals.approvedPurchaseEstimate += purchase.lineTotal ?? 0;
    }
  }

  // --- Photos -------------------------------------------------------------
  // Read in parallel, then attached to rows already built. A byte budget guards
  // the document: photos are base64-inlined, so an unusually large set would
  // produce a PDF too big to email. Rows past the budget render without one
  // rather than failing the report.
  const wantsPhotos = enabledSections(config).some(
    (section) =>
      (section.key === 'ASSETS' || section.key === 'ATTENTION') &&
      section.columns.some((column) => column.key === 'photo'),
  );

  if (wantsPhotos) {
    const budget = isPreview ? 6 * 1024 * 1024 : 24 * 1024 * 1024;
    const jobs = assets.filter((asset) => photoPaths.has(asset.id));

    const loaded = await Promise.all(
      jobs.map(async (asset) => ({
        asset,
        dataUri: await readImageAsDataUri(photoPaths.get(asset.id) as string),
      })),
    );

    let used = 0;
    for (const { asset, dataUri } of loaded) {
      if (!dataUri) continue;
      if (used + dataUri.length > budget) {
        console.warn('[reports] photo budget reached; remaining assets render without photos');
        break;
      }
      used += dataUri.length;
      asset.photoDataUri = dataUri;
    }
  }

  // Built after photos are attached: these rows are the same objects, so an
  // earlier copy would snapshot photoDataUri while it was still null.
  const attention = assets
    .filter((asset) => asset.status === 'BROKEN' || asset.status === 'NEEDS_REPLACEMENT')
    .sort(
      (a, b) =>
        STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status] ||
        a.department.localeCompare(b.department) ||
        a.assetTag.localeCompare(b.assetTag, undefined, { numeric: true }),
    );

  // --- Meta ---------------------------------------------------------------

  const isEveryDepartment =
    user.role === 'ADMIN' && config.departmentIds.length === 0;

  const coveredDepartments = departments.filter((department) =>
    departmentsWithAssets.has(department.id),
  );

  const scopeLabel = pickedAssets
    ? `${assets.length} selected asset${assets.length === 1 ? '' : 's'}${
        coveredDepartments.length === 1 ? ` · ${coveredDepartments[0].name}` : ''
      }`
    : isEveryDepartment
      ? 'All departments'
      : departments.length === 1
        ? departments[0].name
        : `${departments.length} departments`;

  return {
    candidates,
    data: {
      meta: {
        companyName: appConfig.branding.companyName,
        tagline: appConfig.branding.tagline,
        title:
          config.title?.trim() ||
          (isEveryDepartment ? 'Asset & Purchase Planning Report' : 'Department Asset Report'),
        scopeLabel,
        groupByLabel: GROUP_BY_NOUN[config.groupBy],
        generatedAt: new Date(),
        generatedByName: user.name,
        generatedByRole: user.role === 'ADMIN' ? 'Administrator' : 'Department Head',
        videoLinksArePublic: isPublicVideoAccessConfigured(),
        config,
        warnings,
        isPreview,
        editable,
      },
      totals,
      groups: orderedGroups,
      ungrouped,
      attention,
    },
  };
}

function sortPurchases(a: ReportPurchaseRow, b: ReportPurchaseRow): number {
  const statusRank = (status: PurchaseStatus) =>
    status === 'PENDING' ? 0 : status === 'APPROVED' ? 1 : 2;

  return (
    statusRank(a.status) - statusRank(b.status) ||
    PRIORITY_SEVERITY[a.priority] - PRIORITY_SEVERITY[b.priority] ||
    (b.lineTotal ?? 0) - (a.lineTotal ?? 0)
  );
}
