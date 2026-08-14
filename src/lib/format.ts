import type { AssetStatus, PurchasePriority, PurchaseStatus, PurchaseKind } from '@prisma/client';

/**
 * Shared formatting + display labels.
 *
 * Deliberately free of `server-only` and of any Node import: the exact same
 * functions run in the browser tables, in server components, and inside the PDF
 * template, so a number can never be formatted one way on screen and another way
 * in the CEO's report.
 */

const CURRENCY_CODE = process.env.NEXT_PUBLIC_CURRENCY_CODE || 'USD';
const CURRENCY_LOCALE = process.env.NEXT_PUBLIC_CURRENCY_LOCALE || 'en-US';

export function formatMoney(value: number | null | undefined, opts?: { blank?: string }): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return opts?.blank ?? '-';
  }
  return new Intl.NumberFormat(CURRENCY_LOCALE, {
    style: 'currency',
    currency: CURRENCY_CODE,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatMoneyPrecise(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat(CURRENCY_LOCALE, {
    style: 'currency',
    currency: CURRENCY_CODE,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat(CURRENCY_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '-';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat(CURRENCY_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** '2020-05-01' for <input type="date"> without timezone drift. */
export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Age in whole years, or null when the purchase date is unknown. */
export function ageInYears(purchaseDate: Date | string | null | undefined): number | null {
  if (!purchaseDate) return null;
  const d = typeof purchaseDate === 'string' ? new Date(purchaseDate) : purchaseDate;
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// Asset tags
//
// A tag is department code + category code + a number counted within that pair,
// e.g. WRK-NUT-004. These two live here rather than next to the generator in
// asset-tag.ts because that module is server-only: the add-asset form has to
// work out the same number in the browser to show what the asset will be called.
// ---------------------------------------------------------------------------

export function assetTagPrefix(departmentCode: string, categoryCode: string): string {
  return `${departmentCode}-${categoryCode}-`;
}

/**
 * Highest number already used under a prefix, or 0.
 *
 * Tags that do not follow the numeric convention are ignored rather than
 * treated as an error: tags predating this scheme (PRT-001) and hand-written
 * ones stay perfectly valid, they simply do not take part in the numbering.
 */
export function highestTagNumber(assetTags: string[], prefix: string): number {
  let highest = 0;

  for (const assetTag of assetTags) {
    if (!assetTag.startsWith(prefix)) continue;
    const suffix = assetTag.slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      highest = Math.max(highest, Number(suffix));
    }
  }

  return highest;
}

/** The tag an asset would be given next in this category, e.g. WRK-NUT-004. */
export function previewNextAssetTag(
  departmentCode: string,
  categoryCode: string,
  existingTags: string[],
): string {
  const prefix = assetTagPrefix(departmentCode, categoryCode);
  return `${prefix}${String(highestTagNumber(existingTags, prefix) + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Labels - the single source of truth for how an enum reads to a human.
// ---------------------------------------------------------------------------

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  IN_USE: 'In use',
  IDLE: 'Idle',
  NEEDS_REPLACEMENT: 'Needs replacement',
  BROKEN: 'Broken',
};

export const ASSET_STATUS_ORDER: AssetStatus[] = [
  'IN_USE',
  'IDLE',
  'NEEDS_REPLACEMENT',
  'BROKEN',
];

export const PURCHASE_PRIORITY_LABELS: Record<PurchasePriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const PURCHASE_PRIORITY_ORDER: PurchasePriority[] = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
];

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const PURCHASE_KIND_LABELS: Record<PurchaseKind, string> = {
  NEW: 'New purchase',
  REPLACEMENT: 'Replacement',
};

/** Rank used to sort purchase requests so the urgent ones surface first. */
export function priorityRank(priority: PurchasePriority): number {
  return PURCHASE_PRIORITY_ORDER.indexOf(priority);
}

/** Statuses that mean "this machine is a problem" - drives the attention counts. */
export function isAttentionStatus(status: AssetStatus): boolean {
  return status === 'NEEDS_REPLACEMENT' || status === 'BROKEN';
}
