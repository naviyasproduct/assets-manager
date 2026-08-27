/**
 * Every column a report table can contain, and the arithmetic that keeps any
 * combination of them fitting on A4.
 *
 * This file is deliberately free of `server-only` and of any HTML: the browser
 * imports it to draw the column picker, and the PDF template imports it to lay
 * the tables out. The cell renderers live in `template.ts`, keyed by the same
 * union, so a column added here without a renderer is a typecheck failure
 * rather than a blank column in a document going to the CEO.
 *
 * ## Widths
 *
 * `table-layout: fixed` does not grow a column to fit its contents - a cell
 * that is too wide simply draws over its neighbour, which is the bug the
 * 2026-08-25 work existed to fix. With a fixed set of columns those widths
 * could be measured once and written into the colgroup. They cannot be any
 * more, so every column carries what it needs and `solveColumnWidths` does the
 * measuring at build time:
 *
 *  - `hardPx` - below this the column *overlaps*. Nowrap content (a status
 *    pill, a date, a right-aligned figure) and the fixed-size photo. The
 *    solver never goes under it; if the hard floors do not fit, the
 *    combination is refused outright rather than rendered broken.
 *  - `softPx` - the widest unbreakable word. Below this a wrapping cell still
 *    renders, it just splits mid-word ("Workstatio / n"). A strong preference,
 *    and the solver reports when it had to give one up.
 *
 * Both are px at 688px of usable page width, and both are measured rather than
 * guessed - see the width-probe note in HANDOVER.md.
 */

export type ReportOrientation = 'PORTRAIT' | 'LANDSCAPE';

/**
 * A4 less the 14mm margins either side that pdf.ts sets, at 96dpi.
 *
 * Portrait is 210mm wide, landscape 297mm. Landscape exists because the floors
 * below are real: eleven or twelve columns genuinely do not fit across a
 * portrait page, and turning the paper is a better answer than refusing or than
 * printing columns on top of each other.
 */
export const USABLE_WIDTH_PX = 688;
export const USABLE_WIDTH_LANDSCAPE_PX = 1016;

export function usableWidthPx(orientation: ReportOrientation): number {
  return orientation === 'LANDSCAPE' ? USABLE_WIDTH_LANDSCAPE_PX : USABLE_WIDTH_PX;
}

export type ColumnMeta = {
  label: string;
  /** Narrowest without overlapping. Inviolable. */
  hardPx: number;
  /** Narrowest without breaking a word mid-way. A preference. */
  softPx: number;
  /** Share of whatever is left once every column has its softPx. */
  weight: number;
  /** Right-aligned with tabular figures. */
  num?: boolean;
  /** Rendered with no header text (the photo column). */
  headerless?: boolean;
  /** Shown under the label in the column picker. */
  hint?: string;
};

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const ASSET_COLUMNS = {
  photo: {
    label: 'Photo',
    // The thumbnail is a fixed 38px plus the cell's 6px padding either side.
    hardPx: 52,
    softPx: 52,
    // Never grows: extra width would only stretch the cell around the image.
    weight: 0,
    headerless: true,
    hint: 'Thumbnail, inlined into the PDF',
  },
  assetTag: {
    label: 'Tag',
    // Tags wrap at their own hyphens, so the unbreakable chunk is "NUT-001".
    hardPx: 46,
    softPx: 76,
    weight: 1,
    hint: 'WRK-NUT-001',
  },
  name: {
    label: 'Asset',
    hardPx: 45,
    softPx: 90,
    weight: 3,
    hint: 'Carries the note underneath unless Notes is its own column',
  },
  category: {
    label: 'Category',
    // "Workstation" is the longest word the live data puts in here, and the
    // header itself needs 66px.
    hardPx: 66,
    softPx: 76,
    weight: 1.5,
  },
  department: {
    label: 'Department',
    // The header word is the floor here: 82px, wider than most department names.
    hardPx: 82,
    softPx: 82,
    weight: 1.5,
  },
  location: {
    label: 'Location',
    hardPx: 65,
    softPx: 66,
    weight: 1.2,
  },
  status: {
    label: 'Status',
    // "Needs replacement" is a nowrap pill and measures 113px.
    hardPx: 113,
    softPx: 113,
    weight: 0.6,
  },
  serialNumber: {
    label: 'Serial',
    hardPx: 49,
    softPx: 78,
    weight: 1,
  },
  purchaseDate: {
    label: 'Purchased',
    // Nowrap, and the header is wider than the dates under it.
    hardPx: 77,
    softPx: 77,
    weight: 0.5,
    num: true,
  },
  purchaseCost: {
    label: 'Cost',
    hardPx: 62,
    softPx: 62,
    weight: 0.5,
    num: true,
  },
  fixCount: {
    label: 'Fixes',
    hardPx: 42,
    softPx: 42,
    weight: 0.3,
    num: true,
    hint: 'How many repairs are on record',
  },
  notes: {
    label: 'Notes',
    hardPx: 47,
    softPx: 110,
    weight: 2.5,
  },
} as const satisfies Record<string, ColumnMeta>;

export type AssetColumnKey = keyof typeof ASSET_COLUMNS;

// ---------------------------------------------------------------------------
// Purchase requests
// ---------------------------------------------------------------------------

export const PURCHASE_COLUMNS = {
  title: {
    label: 'Requested item',
    // "Requested" in the header is the floor, not the item names, which wrap.
    hardPx: 72,
    softPx: 110,
    weight: 3,
    hint: 'Carries the justification underneath unless that is its own column',
  },
  category: { label: 'Category', hardPx: 66, softPx: 76, weight: 1 },
  department: { label: 'Department', hardPx: 82, softPx: 82, weight: 1.2 },
  kind: {
    label: 'Type',
    // "New purchase" is a nowrap label and measures 81px.
    hardPx: 81,
    softPx: 81,
    weight: 0.5,
  },
  quantity: { label: 'Qty', hardPx: 34, softPx: 34, weight: 0.3, num: true },
  estimatedCost: { label: 'Unit est.', hardPx: 76, softPx: 76, weight: 0.5, num: true },
  lineTotal: { label: 'Line total', hardPx: 76, softPx: 76, weight: 0.5, num: true },
  priority: { label: 'Priority', hardPx: 63, softPx: 63, weight: 0.4 },
  status: { label: 'Status', hardPx: 63, softPx: 63, weight: 0.4 },
  requestedByName: { label: 'Requested by', hardPx: 72, softPx: 78, weight: 1 },
  requestedAt: { label: 'Requested', hardPx: 74, softPx: 74, weight: 0.5, num: true },
  replaces: {
    label: 'Replaces',
    hardPx: 63,
    softPx: 90,
    weight: 1,
    hint: 'The machine this request would replace',
  },
  justification: { label: 'Justification', hardPx: 89, softPx: 120, weight: 2.5 },
} as const satisfies Record<string, ColumnMeta>;

export type PurchaseColumnKey = keyof typeof PURCHASE_COLUMNS;

// ---------------------------------------------------------------------------
// Repairs
// ---------------------------------------------------------------------------

export const FIX_COLUMNS = {
  assetTag: { label: 'Tag', hardPx: 46, softPx: 76, weight: 1 },
  title: {
    label: 'Repair',
    hardPx: 50,
    softPx: 110,
    weight: 2.5,
    hint: 'Carries the asset name underneath unless that is its own column',
  },
  assetName: { label: 'Asset', hardPx: 45, softPx: 90, weight: 1.5 },
  department: { label: 'Department', hardPx: 82, softPx: 82, weight: 1 },
  fixedByName: { label: 'Fixed by', hardPx: 43, softPx: 78, weight: 1 },
  fixedAt: { label: 'Date', hardPx: 74, softPx: 74, weight: 0.5, num: true },
  symptom: { label: 'Symptom', hardPx: 65, softPx: 100, weight: 1.5 },
  video: {
    label: 'Video',
    // "Watch repair video" is a nowrap link.
    hardPx: 110,
    softPx: 110,
    weight: 0.5,
  },
} as const satisfies Record<string, ColumnMeta>;

export type FixColumnKey = keyof typeof FIX_COLUMNS;

// ---------------------------------------------------------------------------
// Registry lookup
// ---------------------------------------------------------------------------

export const ASSET_COLUMN_KEYS = Object.keys(ASSET_COLUMNS) as AssetColumnKey[];
export const PURCHASE_COLUMN_KEYS = Object.keys(PURCHASE_COLUMNS) as PurchaseColumnKey[];
export const FIX_COLUMN_KEYS = Object.keys(FIX_COLUMNS) as FixColumnKey[];

/** Every column table, keyed the way the config addresses them. */
export const COLUMN_SETS = {
  asset: ASSET_COLUMNS as Record<string, ColumnMeta>,
  purchase: PURCHASE_COLUMNS as Record<string, ColumnMeta>,
  fix: FIX_COLUMNS as Record<string, ColumnMeta>,
} as const;

export type ColumnSetName = keyof typeof COLUMN_SETS;

/** What today's report prints, so the default setup reproduces it exactly. */
export const DEFAULT_ASSET_COLUMNS: AssetColumnKey[] = [
  'photo',
  'assetTag',
  'name',
  'category',
  'location',
  'status',
  'purchaseDate',
  'purchaseCost',
  'fixCount',
];

export const DEFAULT_ATTENTION_COLUMNS: AssetColumnKey[] = [
  'photo',
  'assetTag',
  'name',
  'department',
  'category',
  'status',
  'purchaseDate',
];

export const DEFAULT_PURCHASE_COLUMNS: PurchaseColumnKey[] = [
  'title',
  'category',
  'kind',
  'quantity',
  'estimatedCost',
  'lineTotal',
  'priority',
  'status',
];

export const DEFAULT_FIX_COLUMNS: FixColumnKey[] = [
  'assetTag',
  'title',
  'fixedByName',
  'fixedAt',
  'video',
];

// ---------------------------------------------------------------------------
// The width solver
// ---------------------------------------------------------------------------

export type SolvedColumn = {
  key: string;
  meta: ColumnMeta;
  /** Integer percent. The whole set always sums to exactly 100. */
  percent: number;
};

export type WidthSolution =
  | { ok: true; columns: SolvedColumn[]; tight: string[] }
  | { ok: false; error: string; shortfallPx: number };

/**
 * Turns a chosen set of columns into colgroup percentages.
 *
 * Three rules, in order, and the first is the one that matters: no column ever
 * ends up under its `hardPx`, because that is the width at which cells start
 * drawing over each other. Everything else - honouring `softPx`, spending the
 * leftover by weight, a hand-dragged width - gives way to it.
 *
 * `overrides` are hand-set percentages from dragging a column edge. They are
 * treated as wishes, not instructions: clamped up to the hard floor, and
 * renormalised with everything else so the row still totals 100.
 */
export function solveColumnWidths(
  keys: string[],
  set: Record<string, ColumnMeta>,
  overrides: Record<string, number> = {},
  usablePx: number = USABLE_WIDTH_PX,
): WidthSolution {
  const cols = keys
    .filter((key) => key in set)
    .map((key) => ({ key, meta: set[key] }));

  if (cols.length === 0) {
    return { ok: false, error: 'Pick at least one column.', shortfallPx: 0 };
  }

  const hardSum = cols.reduce((sum, c) => sum + c.meta.hardPx, 0);
  if (hardSum > usablePx) {
    return {
      ok: false,
      error:
        usablePx === USABLE_WIDTH_PX
          ? 'These columns cannot fit across a portrait page. Turn the page landscape, or remove one.'
          : 'These columns cannot fit across the page even landscape. Remove one.',
      shortfallPx: Math.ceil(hardSum - usablePx),
    };
  }

  // Step 1: a target width in px for every column.
  const softSum = cols.reduce((sum, c) => sum + c.meta.softPx, 0);
  const tight: string[] = [];
  let targets: number[];

  if (softSum > usablePx) {
    // Not enough room for every column's longest word. Give up the difference
    // proportionally rather than starving whichever column comes last.
    const slack = (usablePx - hardSum) / (softSum - hardSum);
    targets = cols.map((c) => c.meta.hardPx + (c.meta.softPx - c.meta.hardPx) * slack);
    for (const c of cols) {
      if (c.meta.softPx > c.meta.hardPx) tight.push(c.key);
    }
  } else {
    const spare = usablePx - softSum;
    const weightSum = cols.reduce((sum, c) => sum + c.meta.weight, 0);
    targets = cols.map(
      (c) => c.meta.softPx + (weightSum > 0 ? (spare * c.meta.weight) / weightSum : 0),
    );
  }

  // Step 2: hand-set widths win over the computed target, within reason.
  targets = cols.map((c, i) => {
    const override = overrides[c.key];
    if (override === undefined || !Number.isFinite(override)) return targets[i];
    return Math.max(c.meta.hardPx, (override / 100) * usablePx);
  });

  // Step 3: px -> integer percent, distributing the rounding error by largest
  // remainder so the row totals exactly 100 rather than 99 or 101. The template
  // depends on that: a colgroup summing to less lets the renderer improvise.
  const scale = 100 / targets.reduce((a, b) => a + b, 0);
  const scaled = targets.map((t) => t * scale);
  const floors = scaled.map((v) => Math.floor(v));
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);

  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const percents = [...floors];
  for (let n = 0; n < order.length && remainder > 0; n += 1) {
    percents[order[n].i] += 1;
    remainder -= 1;
  }

  // Step 4: rounding can push a column back under its hard floor. Take the
  // percent back off whichever column has the most room to spare, and keep
  // going until every floor holds. Bounded by the number of columns, because
  // each pass fixes at least one and hardSum <= 100% is already established.
  const hardPercent = cols.map((c) => Math.ceil((c.meta.hardPx / usablePx) * 100));

  for (let pass = 0; pass < cols.length * 2; pass += 1) {
    const short = percents.findIndex((p, i) => p < hardPercent[i]);
    if (short === -1) break;

    let donor = -1;
    let donorSlack = 0;
    for (let i = 0; i < percents.length; i += 1) {
      const slack = percents[i] - hardPercent[i];
      if (slack > donorSlack) {
        donorSlack = slack;
        donor = i;
      }
    }
    if (donor === -1) break;

    percents[donor] -= 1;
    percents[short] += 1;
  }

  return {
    ok: true,
    tight,
    columns: cols.map((c, i) => ({ key: c.key, meta: c.meta, percent: percents[i] })),
  };
}
