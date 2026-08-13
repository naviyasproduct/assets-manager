import 'server-only';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AssetStatus, PurchasePriority, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config, buildVideoWatchUrl, isPublicVideoAccessConfigured } from '@/lib/config';
import { readImageAsDataUri } from '@/lib/image-storage';
import { decimalToNumber } from '@/lib/serialize';
import { ASSET_STATUS_ORDER } from '@/lib/format';
import type { SessionUser } from '@/lib/auth';
import type { z } from 'zod';
import type { reportRequestSchema } from '@/lib/validation';

export type ReportOptions = z.infer<typeof reportRequestSchema>;

export type StatusCounts = Record<AssetStatus, number>;

export type ReportAssetRow = {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  serialNumber: string | null;
  location: string | null;
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
  kind: 'NEW' | 'REPLACEMENT';
  quantity: number;
  estimatedCost: number | null;
  lineTotal: number | null;
  justification: string;
  priority: PurchasePriority;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedByName: string;
  requestedAt: Date;
  replacesAssetTag: string | null;
  replacesAssetName: string | null;
};

export type ReportFixRow = {
  id: string;
  title: string;
  assetTag: string;
  assetName: string;
  fixedByName: string;
  fixedAt: Date;
  videoUrl: string | null;
};

export type ReportDepartmentSection = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  location: string | null;
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

export type ReportData = {
  meta: {
    companyName: string;
    tagline: string;
    logoDataUri: string | null;
    title: string;
    scopeLabel: string;
    generatedAt: Date;
    generatedByName: string;
    generatedByRole: string;
    isCompanyWide: boolean;
    /** False when no Cloudflare Tunnel is set up - video links are LAN-only. */
    videoLinksArePublic: boolean;
    options: ReportOptions;
  };
  totals: {
    departmentCount: number;
    assetCount: number;
    statusCounts: StatusCounts;
    knownValue: number;
    assetsWithUnknownCost: number;
    pendingPurchaseCount: number;
    pendingPurchaseEstimate: number;
    approvedPurchaseCount: number;
    approvedPurchaseEstimate: number;
    fixCount: number;
    videoCount: number;
  };
  departments: ReportDepartmentSection[];
  /** Cross-department attention list, most urgent first. Company-wide only. */
  attention: Array<ReportAssetRow & { departmentName: string }>;
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

/**
 * Reads the logo once and inlines it as a data URI.
 *
 * Puppeteer renders the report with setContent and no network access, so an
 * <img src="/logo.png"> would silently render as a broken image in a document
 * that goes to the CEO. Inlining removes that failure mode entirely.
 */
let logoCache: { key: string; value: string | null } | undefined;

async function loadLogoDataUri(): Promise<string | null> {
  const logoPath = config.branding.logoPath;
  if (!logoPath) return null;

  if (logoCache?.key === logoPath) return logoCache.value;

  try {
    const absolute = path.isAbsolute(logoPath)
      ? logoPath
      : path.resolve(process.cwd(), logoPath);

    const buffer = await fsp.readFile(absolute);
    const ext = path.extname(absolute).toLowerCase();

    const mime =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/png';

    const value = `data:${mime};base64,${buffer.toString('base64')}`;
    logoCache = { key: logoPath, value };
    return value;
  } catch {
    // Missing logo is not an error: the template falls back to a typeset
    // wordmark, which still looks deliberate.
    logoCache = { key: logoPath, value: null };
    return null;
  }
}

/**
 * Gathers everything the template needs in one pass.
 *
 * Scope rule: a department head always gets their own department, whatever they
 * asked for. Only an admin can produce the company-wide roll-up.
 */
export async function buildReportData(
  user: SessionUser,
  options: ReportOptions,
): Promise<ReportData> {
  const scopedDepartmentId =
    user.role === 'ADMIN'
      ? options.departmentId === 'ALL'
        ? null
        : options.departmentId
      : (user.departmentId ?? '__none__');

  const departmentWhere: Prisma.DepartmentWhereInput = scopedDepartmentId
    ? { id: scopedDepartmentId }
    : {};

  const assetStatusFilter =
    options.statuses && options.statuses.length > 0
      ? { status: { in: options.statuses } }
      : {};

  const departments = await prisma.department.findMany({
    where: departmentWhere,
    orderBy: { name: 'asc' },
    include: {
      assets: {
        where: assetStatusFilter,
        include: { _count: { select: { fixes: true } } },
      },
      purchaseRequests: {
        // Rejected requests are deliberately excluded: the CEO is deciding what
        // to buy, not reviewing what was already turned down.
        where: { status: { in: ['PENDING', 'APPROVED'] } },
        include: {
          requestedBy: { select: { name: true } },
          replacesAsset: { select: { assetTag: true, name: true } },
        },
      },
    },
  });

  if (departments.length === 0) {
    throw new Error('No departments matched this report.');
  }

  const departmentIds = departments.map((d) => d.id);

  // Fix history is fetched separately so the video-link section can be capped at
  // the most recent repairs without dragging every historical row into memory.
  const fixes = options.includeFixes
    ? await prisma.machineFix.findMany({
        where: {
          asset: { departmentId: { in: departmentIds } },
          videoToken: { not: null },
        },
        orderBy: { fixedAt: 'desc' },
        take: 200,
        include: {
          asset: {
            select: { assetTag: true, name: true, departmentId: true },
          },
        },
      })
    : [];

  const totals = {
    departmentCount: departments.length,
    assetCount: 0,
    statusCounts: emptyStatusCounts(),
    knownValue: 0,
    assetsWithUnknownCost: 0,
    pendingPurchaseCount: 0,
    pendingPurchaseEstimate: 0,
    approvedPurchaseCount: 0,
    approvedPurchaseEstimate: 0,
    fixCount: fixes.length,
    videoCount: fixes.filter((f) => f.videoToken).length,
  };

  const attention: Array<ReportAssetRow & { departmentName: string }> = [];

  // Photos are read from disk after the rows are built, so the reads can happen
  // in parallel rather than one at a time inside the mapping loop.
  const photoJobs: Array<{ row: ReportAssetRow; relativePath: string }> = [];

  const sections: ReportDepartmentSection[] = departments.map((department) => {
    const statusCounts = emptyStatusCounts();
    let knownValue = 0;
    let assetsWithUnknownCost = 0;

    const assets: ReportAssetRow[] = department.assets
      .map((asset) => {
        const cost = decimalToNumber(asset.purchaseCost);
        statusCounts[asset.status] += 1;
        if (cost === null) assetsWithUnknownCost += 1;
        else knownValue += cost;

        const row: ReportAssetRow = {
          id: asset.id,
          assetTag: asset.assetTag,
          name: asset.name,
          category: asset.category,
          serialNumber: asset.serialNumber,
          location: asset.location,
          status: asset.status,
          purchaseDate: asset.purchaseDate,
          purchaseCost: cost,
          notes: asset.notes,
          fixCount: asset._count.fixes,
          photoDataUri: null,
        };

        if (asset.photoRelativePath) {
          photoJobs.push({ row, relativePath: asset.photoRelativePath });
        }

        return row;
      })
      .sort(
        (a, b) =>
          STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status] ||
          a.assetTag.localeCompare(b.assetTag, undefined, { numeric: true }),
      );

    let pendingPurchaseCount = 0;
    let pendingPurchaseEstimate = 0;

    const purchases: ReportPurchaseRow[] = department.purchaseRequests
      .map((request) => {
        const unitCost = decimalToNumber(request.estimatedCost);
        const lineTotal = unitCost === null ? null : unitCost * request.quantity;

        if (request.status === 'PENDING') {
          pendingPurchaseCount += 1;
          pendingPurchaseEstimate += lineTotal ?? 0;
          totals.pendingPurchaseCount += 1;
          totals.pendingPurchaseEstimate += lineTotal ?? 0;
        } else if (request.status === 'APPROVED') {
          totals.approvedPurchaseCount += 1;
          totals.approvedPurchaseEstimate += lineTotal ?? 0;
        }

        return {
          id: request.id,
          title: request.title,
          category: request.category,
          kind: request.kind,
          quantity: request.quantity,
          estimatedCost: unitCost,
          lineTotal,
          justification: request.justification,
          priority: request.priority,
          status: request.status as 'PENDING' | 'APPROVED',
          requestedByName: request.requestedBy.name,
          requestedAt: request.createdAt,
          replacesAssetTag: request.replacesAsset?.assetTag ?? null,
          replacesAssetName: request.replacesAsset?.name ?? null,
        };
      })
      .sort(
        (a, b) =>
          // Pending before approved, then most urgent, then largest spend.
          (a.status === b.status ? 0 : a.status === 'PENDING' ? -1 : 1) ||
          PRIORITY_SEVERITY[a.priority] - PRIORITY_SEVERITY[b.priority] ||
          (b.lineTotal ?? 0) - (a.lineTotal ?? 0),
      );

    const departmentFixes: ReportFixRow[] = fixes
      .filter((fix) => fix.asset.departmentId === department.id)
      .map((fix) => ({
        id: fix.id,
        title: fix.title,
        assetTag: fix.asset.assetTag,
        assetName: fix.asset.name,
        fixedByName: fix.fixedByName,
        fixedAt: fix.fixedAt,
        videoUrl: fix.videoToken ? buildVideoWatchUrl(fix.videoToken) : null,
      }));

    totals.assetCount += assets.length;
    totals.knownValue += knownValue;
    totals.assetsWithUnknownCost += assetsWithUnknownCost;
    for (const status of ASSET_STATUS_ORDER) {
      totals.statusCounts[status] += statusCounts[status];
    }

    return {
      id: department.id,
      name: department.name,
      code: department.code,
      description: department.description,
      location: department.location,
      assetCount: assets.length,
      statusCounts,
      knownValue,
      assetsWithUnknownCost,
      assets,
      purchases,
      pendingPurchaseCount,
      pendingPurchaseEstimate,
      fixes: departmentFixes,
    };
  });

  // --- Photos -------------------------------------------------------------
  // Read in parallel, then attached to the rows already built. A byte budget
  // guards the document: photos are base64-inlined, so an unusually large set
  // would otherwise produce a PDF too big to email. Rows past the budget simply
  // render without a photo rather than failing the report.
  const PHOTO_BUDGET_BYTES = 24 * 1024 * 1024;

  const loadedPhotos = await Promise.all(
    photoJobs.map(async (job) => ({
      row: job.row,
      dataUri: await readImageAsDataUri(job.relativePath),
    })),
  );

  let photoBytesUsed = 0;
  for (const { row, dataUri } of loadedPhotos) {
    if (!dataUri) continue;
    if (photoBytesUsed + dataUri.length > PHOTO_BUDGET_BYTES) {
      console.warn('[reports] photo budget reached; remaining assets render without photos');
      break;
    }
    photoBytesUsed += dataUri.length;
    row.photoDataUri = dataUri;
  }

  // Built only after photos are attached. These rows are copies, so assembling
  // them earlier would snapshot photoDataUri while it was still null and the
  // attention table would silently render without thumbnails.
  for (const section of sections) {
    for (const asset of section.assets) {
      if (asset.status === 'BROKEN' || asset.status === 'NEEDS_REPLACEMENT') {
        attention.push({ ...asset, departmentName: section.name });
      }
    }
  }

  attention.sort(
    (a, b) =>
      STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status] ||
      a.departmentName.localeCompare(b.departmentName),
  );

  const isCompanyWide = scopedDepartmentId === null;

  return {
    meta: {
      companyName: config.branding.companyName,
      tagline: config.branding.tagline,
      logoDataUri: await loadLogoDataUri(),
      title: isCompanyWide ? 'Asset & Purchase Planning Report' : 'Department Asset Report',
      scopeLabel: isCompanyWide ? 'All departments' : sections[0].name,
      generatedAt: new Date(),
      generatedByName: user.name,
      generatedByRole: user.role === 'ADMIN' ? 'Administrator' : 'Department Head',
      isCompanyWide,
      videoLinksArePublic: isPublicVideoAccessConfigured(),
      options,
    },
    totals,
    departments: sections,
    attention,
  };
}
