import { z } from 'zod';

/**
 * Every write path goes through one of these schemas. Rules were chosen to be
 * forgiving about real-world data entry (a lot of older equipment has unknown
 * purchase dates and costs) while still rejecting nonsense.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (label: string, max: number) =>
  trimmed(max).min(1, `${label} is required.`);

/** Turns '' into null so blank form fields clear a column instead of storing ''. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Accepts '', null, or a numeric string. Rejects negatives. */
const optionalMoney = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : Number.NaN;
  })
  .refine((v) => v === null || (!Number.isNaN(v) && v >= 0), {
    message: 'Cost must be a positive number, or left blank if unknown.',
  })
  .refine((v) => v === null || v <= 9_999_999_999, {
    message: 'Cost is unrealistically large.',
  });

/** Accepts '', null, or YYYY-MM-DD. Rejects future purchase dates. */
const optionalPastDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  })
  .refine((v) => v !== undefined, { message: 'Enter a valid date (YYYY-MM-DD).' })
  .refine(
    (v) => {
      if (!v) return true;
      // Allow today plus a day of slack for timezone drift between LAN clients.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return v <= tomorrow;
    },
    { message: 'Purchase date cannot be in the future.' },
  );

export const assetStatusEnum = z.enum(['IN_USE', 'IDLE', 'NEEDS_REPLACEMENT', 'BROKEN']);
export const purchaseKindEnum = z.enum(['NEW', 'REPLACEMENT']);
export const purchasePriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const purchaseStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export const roleEnum = z.enum(['ADMIN', 'DEPT_HEAD']);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters.')
      .max(200, 'That password is too long.'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'Choose a password different from your current one.',
    path: ['newPassword'],
  });

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export const departmentCreateSchema = z.object({
  name: requiredText('Department name', 100),
  code: trimmed(10)
    .min(2, 'Code must be at least 2 characters.')
    .toUpperCase()
    .regex(/^[A-Z0-9]+$/, 'Code may only contain letters and numbers (e.g. PRT).'),
  description: optionalText(500),
  location: optionalText(120),
});

export const departmentUpdateSchema = departmentCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Asset categories
// ---------------------------------------------------------------------------

/** Same shape as a department code, and for the same reason: it lands in a tag. */
const shortCode = trimmed(10)
  .min(2, 'Code must be at least 2 characters.')
  .toUpperCase()
  .regex(/^[A-Z0-9]+$/, 'Code may only contain letters and numbers (e.g. NUT).');

export const assetCategoryCreateSchema = z.object({
  name: requiredText('Category name', 80),
  code: shortCode,
  description: optionalText(300),
  departmentId: requiredText('Department', 40),
});

// The department is deliberately not editable: every asset tag already issued in
// this category starts with that department's code.
export const assetCategoryUpdateSchema = assetCategoryCreateSchema
  .omit({ departmentId: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** No code field: a location never lands in an asset tag, so it never needs one. */
export const locationCreateSchema = z.object({
  name: requiredText('Location name', 120),
  description: optionalText(300),
});

export const locationUpdateSchema = locationCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const assetCreateSchema = z.object({
  name: requiredText('Asset name', 150),
  categoryId: requiredText('Category', 40),
  departmentId: requiredText('Department', 40),
  status: assetStatusEnum.default('IN_USE'),
  // Blank means "generate the next tag for this department" (e.g. PRT-004).
  assetTag: optionalText(40),
  serialNumber: optionalText(120),
  // Optional, and '' clears it: not every machine has a place recorded.
  locationId: optionalText(40),
  purchaseDate: optionalPastDate,
  purchaseCost: optionalMoney,
  notes: optionalText(2000),
});

export const assetUpdateSchema = assetCreateSchema.partial();

// ---------------------------------------------------------------------------
// Purchase requests
// ---------------------------------------------------------------------------

export const purchaseCreateSchema = z
  .object({
    title: requiredText('What needs to be bought', 150),
    category: requiredText('Category', 80),
    departmentId: requiredText('Department', 40),
    kind: purchaseKindEnum.default('NEW'),
    quantity: z.coerce
      .number()
      .int('Quantity must be a whole number.')
      .min(1, 'Quantity must be at least 1.')
      .max(9999, 'Quantity is unrealistically large.')
      .default(1),
    estimatedCost: optionalMoney,
    justification: requiredText('Justification', 2000).pipe(
      z.string().min(10, 'Give the CEO enough context to decide - at least 10 characters.'),
    ),
    priority: purchasePriorityEnum.default('MEDIUM'),
    replacesAssetId: optionalText(40),
  })
  .refine((d) => d.kind !== 'REPLACEMENT' || !!d.replacesAssetId, {
    message: 'Select which asset is being replaced.',
    path: ['replacesAssetId'],
  });

export const purchaseUpdateSchema = z.object({
  title: requiredText('What needs to be bought', 150).optional(),
  category: requiredText('Category', 80).optional(),
  kind: purchaseKindEnum.optional(),
  quantity: z.coerce.number().int().min(1).max(9999).optional(),
  estimatedCost: optionalMoney,
  justification: trimmed(2000).min(10).optional(),
  priority: purchasePriorityEnum.optional(),
  replacesAssetId: optionalText(40),
});

export const purchaseReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: optionalText(1000),
});

// ---------------------------------------------------------------------------
// Machine fixes
// ---------------------------------------------------------------------------

export const fixCreateSchema = z.object({
  title: requiredText('What was fixed', 150),
  description: requiredText('Description', 4000).pipe(
    z.string().min(10, 'Describe the fix so the next person can follow it.'),
  ),
  fixedByName: requiredText('Who fixed it', 120),
  symptom: optionalText(500),
  fixedAt: optionalPastDate,
});

export const fixUpdateSchema = fixCreateSchema.partial();

// ---------------------------------------------------------------------------
// Users (admin only)
// ---------------------------------------------------------------------------

export const userCreateSchema = z
  .object({
    name: requiredText('Name', 120),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
    password: z
      .string()
      .min(10, 'Use at least 10 characters.')
      .max(200, 'That password is too long.'),
    role: roleEnum.default('DEPT_HEAD'),
    departmentId: optionalText(40),
  })
  .refine((d) => d.role !== 'DEPT_HEAD' || !!d.departmentId, {
    message: 'A department head must be assigned to a department.',
    path: ['departmentId'],
  });

export const userUpdateSchema = z.object({
  name: requiredText('Name', 120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: roleEnum.optional(),
  departmentId: optionalText(40),
  isActive: z.boolean().optional(),
  // Admin-initiated reset; forces mustChangePassword back on.
  newPassword: z.string().min(10).max(200).optional(),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportSectionKeyEnum = z.enum([
  'SUMMARY',
  'ATTENTION',
  'ASSETS',
  'PURCHASES',
  'FIXES',
]);

export const reportGroupByEnum = z.enum([
  'DEPARTMENT',
  'LOCATION',
  'CATEGORY',
  'STATUS',
  'NONE',
]);

/**
 * A column in a report table.
 *
 * `key` is checked against the registry in `reports/columns.ts` rather than
 * being an enum here, and unknown keys are dropped instead of rejected. A saved
 * report is a document someone relies on: renaming a column in a later version
 * must leave their setup opening with one column missing, not failing to open.
 * `normalizeReportConfig` is what does the dropping, and it reports what it
 * dropped.
 */
const reportColumnSchema = z.object({
  key: trimmed(40).min(1),
  /** Percent, set by dragging a column edge. Clamped by the width solver. */
  width: z.number().min(1).max(90).optional(),
});

const reportSectionSchema = z.object({
  key: trimmed(20).min(1),
  enabled: z.boolean().default(true),
  columns: z.array(reportColumnSchema).max(30).optional(),
});

/**
 * A block someone added to the page themselves - a note, a heading, a rule, a
 * gap, a forced page break.
 *
 * Free text rather than an enum of approved wordings: this is the part of the
 * document the person laying it out writes. It is escaped in the template like
 * every other value, and `id` is checked against the layout rather than trusted.
 */
const reportBlockSchema = z.object({
  id: trimmed(40).min(1),
  type: z.enum(['TEXT', 'HEADING', 'DIVIDER', 'SPACER', 'BREAK']).default('TEXT'),
  enabled: z.boolean().default(true),
  text: optionalText(2000),
  align: z.enum(['LEFT', 'CENTER', 'RIGHT']).default('LEFT'),
  size: z.enum(['S', 'M', 'L']).default('M'),
  /** SPACER only: the gap in px on the page, at the PDF's own scale. */
  height: z.number().int().min(4).max(400).default(24),
});

/**
 * Everything that decides what a report contains and how it looks.
 *
 * Stored verbatim as the `config` of a ReportPreset, so it is versioned: a
 * config read back out of the database has to survive this file moving on
 * without it.
 */
export const reportConfigSchema = z.object({
  version: z.literal(1).default(1),

  // --- The document -------------------------------------------------------
  title: optionalText(120),
  intro: optionalText(600),

  // --- Scope. An empty list means "no filter", never "nothing" ------------
  departmentIds: z.array(trimmed(40).min(1)).max(200).default([]),
  // May contain the sentinel 'NONE', which selects assets with no location.
  locationIds: z.array(trimmed(40).min(1)).max(200).default([]),
  categoryIds: z.array(trimmed(40).min(1)).max(500).default([]),
  statuses: z.array(assetStatusEnum).max(4).default([]),
  search: optionalText(120),

  // --- Purchase filters ---------------------------------------------------
  // Rejected requests stay out unless explicitly asked for: the report is for
  // deciding what to buy, not reviewing what was already turned down.
  purchaseStatuses: z.array(purchaseStatusEnum).max(3).default(['PENDING', 'APPROVED']),
  purchasePriorities: z.array(purchasePriorityEnum).max(4).default([]),

  // --- Repair filters -----------------------------------------------------
  // On by default because that is what the repair section was built for - the
  // CEO opening a video from the PDF. Turned off, it becomes a plain history.
  fixesRequireVideo: z.boolean().default(true),

  // --- Layout -------------------------------------------------------------
  // Landscape is the escape hatch for a wide table: eleven or twelve columns
  // do not fit across a portrait page whatever the widths say.
  orientation: z.enum(['PORTRAIT', 'LANDSCAPE']).default('PORTRAIT'),
  groupBy: reportGroupByEnum.default('DEPARTMENT'),
  // Right for departments, where a section is a whole part of the business
  // somebody may want to hand out on its own. Grouping by location or condition
  // makes many small groups, and a page each turns a 4-page report into 10.
  pageBreakPerGroup: z.boolean().default(true),
  sections: z.array(reportSectionSchema).max(20).default([]),

  // --- The page as it was laid out on the canvas --------------------------
  // Blocks the person added, the order everything sits in, and the parts they
  // deleted. All three are design decisions rather than data, so they belong
  // in a saved report; the ids inside them are never trusted - the normaliser
  // reconciles them against what actually exists.
  blocks: z.array(reportBlockSchema).max(40).default([]),
  layout: z.array(trimmed(40).min(1)).max(80).default([]),
  hiddenBlocks: z.array(trimmed(80).min(1)).max(400).default([]),
  /** Group keys in the order they were dragged into. Unlisted groups follow. */
  groupOrder: z.array(trimmed(40).min(1)).max(400).default([]),
});

/**
 * One run of the builder: a config, plus the individual rows ticked off by
 * hand.
 *
 * Exclusions live here and not in the config on purpose - they name specific
 * asset ids, which go stale the moment equipment is added or retired, so a
 * saved report must not carry them.
 */
export const reportRequestSchema = z.object({
  config: reportConfigSchema,
  // Set when the report was started from assets ticked on the Assets screen.
  // Empty means no restriction; non-empty means these assets and no others.
  includeAssetIds: z.array(trimmed(40).min(1)).max(5000).default([]),
  excludedAssetIds: z.array(trimmed(40).min(1)).max(5000).default([]),
  excludedPurchaseIds: z.array(trimmed(40).min(1)).max(5000).default([]),
  excludedFixIds: z.array(trimmed(40).min(1)).max(5000).default([]),
  /**
   * Draw the canvas handles into the preview. Ignored when generating a PDF -
   * `buildReportData` only honours it for a preview - so the flag can travel on
   * the one request shape both routes share.
   */
  editable: z.boolean().default(true),
});

export const reportPresetCreateSchema = z.object({
  name: requiredText('Name', 80),
  description: optionalText(300),
  config: reportConfigSchema,
});

export const reportPresetUpdateSchema = reportPresetCreateSchema.partial().extend({
  name: trimmed(80).min(1, 'Name is required.').optional(),
});

// ---------------------------------------------------------------------------
// Error shaping
// ---------------------------------------------------------------------------

export type FieldErrors = Record<string, string>;

/** Flattens a ZodError into { fieldName: firstMessage } for the UI. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
