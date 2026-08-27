/**
 * The report setup: its shape, its defaults, and the one function that turns
 * anything claiming to be a setup into a usable one.
 *
 * Pure - no `server-only`, no Prisma, no HTML. The builder in the browser, the
 * API routes and the PDF template all work from the same normalised object, so
 * what is on screen and what comes out of the printer cannot drift apart.
 *
 * `normalizeReportConfig` is the durability of this feature. A config can
 * arrive from a preset saved months ago, from a URL, or from a browser running
 * an older page, and it must always produce something that renders. It never
 * throws: it fills in what is missing, drops what it does not recognise, and
 * says what it did.
 */
import type { z } from 'zod';
import type { reportConfigSchema } from '@/lib/validation';
import {
  COLUMN_SETS,
  DEFAULT_ASSET_COLUMNS,
  DEFAULT_ATTENTION_COLUMNS,
  DEFAULT_FIX_COLUMNS,
  DEFAULT_PURCHASE_COLUMNS,
  type ColumnSetName,
} from '@/lib/reports/columns';

export type ReportConfig = z.infer<typeof reportConfigSchema>;

export type ReportSectionKey = 'SUMMARY' | 'ATTENTION' | 'ASSETS' | 'PURCHASES' | 'FIXES';
export type ReportGroupBy = 'DEPARTMENT' | 'LOCATION' | 'CATEGORY' | 'STATUS' | 'NONE';

/** Selects assets with no location recorded - how you find unplaced machines. */
export const NO_LOCATION = 'NONE';

/**
 * The parts of the page that are neither a section nor data: the letterhead,
 * the title block, the closing line. They were fixed furniture until the page
 * became something you lay out by hand; now they are blocks like any other and
 * can be moved or taken off, so they have to sit in the layout with the rest.
 */
export const BUILTIN_BLOCKS: Record<string, { label: string; description: string }> = {
  MASTHEAD: {
    label: 'Letterhead',
    description: 'Company name, tagline and the date, across the top',
  },
  TITLE: {
    label: 'Title block',
    description: 'The report title, what it covers, and who prepared it',
  },
  GROUPS: {
    label: 'Equipment sections',
    description: 'One block per department, location or category, with its tables inside',
  },
  ENDNOTE: {
    label: 'Closing line',
    description: 'The "end of report" line at the very bottom',
  },
};

export type ReportBlockType = 'TEXT' | 'HEADING' | 'DIVIDER' | 'SPACER' | 'BREAK';

export const BLOCK_TYPE_LABELS: Record<ReportBlockType, string> = {
  HEADING: 'Heading',
  TEXT: 'Text',
  DIVIDER: 'Divider',
  SPACER: 'Space',
  BREAK: 'Page break',
};

/** A block someone added to the page themselves. */
export type NormalizedBlock = {
  id: string;
  type: ReportBlockType;
  enabled: boolean;
  text: string | null;
  align: 'LEFT' | 'CENTER' | 'RIGHT';
  size: 'S' | 'M' | 'L';
  /** SPACER only, in px at the PDF's own scale. */
  height: number;
};

/**
 * Ids of added blocks carry this prefix so they can never collide with a
 * section key or a builtin - the layout is one flat list of ids, and a block
 * calling itself `ASSETS` would silently take the asset table's place.
 */
export const BLOCK_ID_PREFIX = 'blk-';

export function newBlockId(): string {
  return `${BLOCK_ID_PREFIX}${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultBlock(type: ReportBlockType): NormalizedBlock {
  return {
    id: newBlockId(),
    type,
    enabled: true,
    text:
      type === 'HEADING'
        ? 'Heading'
        : type === 'TEXT'
          ? 'Write anything here - it prints exactly as typed.'
          : null,
    align: 'LEFT',
    size: 'M',
    height: 24,
  };
}

export type SectionMeta = {
  label: string;
  /** One line under the label in the section list. */
  description: string;
  /** Which column registry this section's table draws from, if it has one. */
  columnSet: ColumnSetName | null;
  /** Repeats inside every group, rather than appearing once for the document. */
  perGroup: boolean;
  defaultColumns: string[];
};

export const SECTION_META: Record<ReportSectionKey, SectionMeta> = {
  SUMMARY: {
    label: 'Executive summary',
    description: 'Counts, condition bar and pending spend across everything selected',
    columnSet: null,
    perGroup: false,
    defaultColumns: [],
  },
  ATTENTION: {
    label: 'Needs attention',
    description: 'Broken and due-for-replacement equipment, most severe first',
    columnSet: 'asset',
    perGroup: false,
    defaultColumns: DEFAULT_ATTENTION_COLUMNS,
  },
  ASSETS: {
    label: 'Assets',
    description: 'The equipment list itself',
    columnSet: 'asset',
    perGroup: true,
    defaultColumns: DEFAULT_ASSET_COLUMNS,
  },
  PURCHASES: {
    label: 'Purchase requests',
    description: 'What has been asked for and is still waiting on a decision',
    columnSet: 'purchase',
    perGroup: true,
    defaultColumns: DEFAULT_PURCHASE_COLUMNS,
  },
  FIXES: {
    label: 'Repair history',
    description: 'Past repairs, with links to the videos',
    columnSet: 'fix',
    perGroup: true,
    defaultColumns: DEFAULT_FIX_COLUMNS,
  },
};

/** The order sections take when nothing has been dragged. */
export const SECTION_ORDER: ReportSectionKey[] = [
  'SUMMARY',
  'ATTENTION',
  'ASSETS',
  'PURCHASES',
  'FIXES',
];

export const GROUP_BY_LABELS: Record<ReportGroupBy, string> = {
  DEPARTMENT: 'Department',
  LOCATION: 'Location',
  CATEGORY: 'Category',
  STATUS: 'Condition',
  NONE: 'Nothing - one flat list',
};

/**
 * Purchase requests belong to a department and nothing else - they describe
 * equipment that does not exist yet, so it has no location, no category record
 * and no condition. Grouped by anything but department they render once, after
 * the groups, rather than being duplicated into every one.
 */
export function purchasesCanGroupBy(groupBy: ReportGroupBy): boolean {
  return groupBy === 'DEPARTMENT';
}

/** Repairs hang off an asset, so they follow it everywhere except by status. */
export function fixesCanGroupBy(groupBy: ReportGroupBy): boolean {
  return groupBy === 'DEPARTMENT' || groupBy === 'LOCATION' || groupBy === 'CATEGORY';
}

export type NormalizedColumn = { key: string; width?: number };

export type NormalizedSection = {
  key: ReportSectionKey;
  enabled: boolean;
  columns: NormalizedColumn[];
};

export type NormalizedReportConfig = Omit<ReportConfig, 'sections' | 'blocks'> & {
  sections: NormalizedSection[];
  blocks: NormalizedBlock[];
};

/**
 * The order the page opens in. Everything in the document is addressed by one
 * flat list of ids, which is what lets an added note be dragged in between two
 * sections.
 *
 * The three per-group sections sit in this list too, but they never render at
 * the top level - they render inside every group, and their place here is only
 * their order relative to each other. `GROUPS` is where the run of groups
 * itself lands on the page.
 */
export const DEFAULT_LAYOUT: string[] = [
  'MASTHEAD',
  'TITLE',
  'SUMMARY',
  'ATTENTION',
  'GROUPS',
  'ASSETS',
  'PURCHASES',
  'FIXES',
  'ENDNOTE',
];

/** The setup the page opens on: exactly what the old fixed report produced. */
export function defaultReportConfig(): NormalizedReportConfig {
  return {
    version: 1,
    title: null,
    intro: null,
    departmentIds: [],
    locationIds: [],
    categoryIds: [],
    statuses: [],
    search: null,
    purchaseStatuses: ['PENDING', 'APPROVED'],
    purchasePriorities: [],
    fixesRequireVideo: true,
    orientation: 'PORTRAIT',
    groupBy: 'DEPARTMENT',
    pageBreakPerGroup: true,
    sections: SECTION_ORDER.map((key) => ({
      key,
      enabled: true,
      columns: SECTION_META[key].defaultColumns.map((column) => ({ key: column })),
    })),
    blocks: [],
    layout: [...DEFAULT_LAYOUT],
    hiddenBlocks: [],
    groupOrder: [],
  };
}

function isSectionKey(value: string): value is ReportSectionKey {
  return value in SECTION_META;
}

/**
 * Makes any stored setup safe to render.
 *
 * Guarantees on the way out: every section exists exactly once and in a stable
 * order, every table section has at least one column the renderer knows about,
 * and no column appears twice. Anything it had to change comes back in
 * `warnings` so the page can say so rather than quietly showing something else.
 */
export function normalizeReportConfig(input: Partial<ReportConfig> | null | undefined): {
  config: NormalizedReportConfig;
  warnings: string[];
} {
  const base = defaultReportConfig();
  const warnings: string[] = [];

  if (!input) return { config: base, warnings };

  const sections: NormalizedSection[] = [];
  const seen = new Set<ReportSectionKey>();

  for (const raw of input.sections ?? []) {
    if (!raw || typeof raw.key !== 'string' || !isSectionKey(raw.key)) {
      if (raw?.key) warnings.push(`Section "${raw.key}" is no longer part of reports.`);
      continue;
    }
    if (seen.has(raw.key)) continue;
    seen.add(raw.key);

    const meta = SECTION_META[raw.key];
    const columns: NormalizedColumn[] = [];

    if (meta.columnSet) {
      const registry = COLUMN_SETS[meta.columnSet];
      const takenColumns = new Set<string>();

      for (const column of raw.columns ?? []) {
        if (!column || typeof column.key !== 'string') continue;
        if (takenColumns.has(column.key)) continue;
        if (!(column.key in registry)) {
          warnings.push(`Column "${column.key}" no longer exists and was left out.`);
          continue;
        }
        takenColumns.add(column.key);
        columns.push(
          column.width === undefined ? { key: column.key } : { key: column.key, width: column.width },
        );
      }

      // A table with no columns cannot be rendered at all, so fall back rather
      // than dropping the section the person asked for.
      if (columns.length === 0) {
        for (const key of meta.defaultColumns) columns.push({ key });
        if ((raw.columns ?? []).length > 0) {
          warnings.push(`"${meta.label}" had no usable columns left, so its defaults came back.`);
        }
      }
    }

    sections.push({ key: raw.key, enabled: raw.enabled !== false, columns });
  }

  // A setup that named no sections at all is not a request for an empty
  // document - it is a setup saved before sections existed, or a bare {}.
  const namedNothing = sections.length === 0;

  // Anything the stored setup never mentioned is appended in canonical order
  // and switched off: a section added in a later version must not silently
  // start appearing in a report someone already signed off.
  for (const key of SECTION_ORDER) {
    if (seen.has(key)) continue;
    sections.push({
      key,
      enabled: namedNothing,
      columns: SECTION_META[key].defaultColumns.map((column) => ({ key: column })),
    });
  }

  // --- The page as it was laid out ----------------------------------------
  //
  // Ids arrive from a setup saved months ago and are not trusted. A block may
  // have been deleted, a section may not have existed yet, and the same id may
  // appear twice. What comes out is one entry per thing that really exists, in
  // the order it was left in.

  const blocks: NormalizedBlock[] = [];
  const takenBlockIds = new Set<string>();

  for (const raw of Array.isArray(input.blocks) ? input.blocks : []) {
    if (!raw || typeof raw !== 'object') continue;

    // A block calling itself ASSETS would take the asset table's place in the
    // layout, which is one flat list of ids - so anything without the prefix,
    // or a repeat, is given a fresh id rather than dropped.
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const safeId = id.startsWith(BLOCK_ID_PREFIX) && !takenBlockIds.has(id) ? id : newBlockId();
    takenBlockIds.add(safeId);

    const type: ReportBlockType =
      typeof raw.type === 'string' && raw.type in BLOCK_TYPE_LABELS
        ? (raw.type as ReportBlockType)
        : 'TEXT';

    blocks.push({
      id: safeId,
      type,
      enabled: raw.enabled !== false,
      text: typeof raw.text === 'string' && raw.text !== '' ? raw.text : null,
      align: raw.align === 'CENTER' || raw.align === 'RIGHT' ? raw.align : 'LEFT',
      size: raw.size === 'S' || raw.size === 'L' ? raw.size : 'M',
      height:
        typeof raw.height === 'number' && Number.isFinite(raw.height)
          ? Math.min(400, Math.max(4, Math.round(raw.height)))
          : 24,
    });
  }

  const known = new Set<string>([
    ...Object.keys(BUILTIN_BLOCKS),
    ...sections.map((section) => section.key),
    ...blocks.map((block) => block.id),
  ]);

  const layout: string[] = [];
  const placed = new Set<string>();

  for (const id of Array.isArray(input.layout) ? input.layout : []) {
    if (typeof id !== 'string' || !known.has(id) || placed.has(id)) continue;
    placed.add(id);
    layout.push(id);
  }

  // A layout saved before the run of groups was a block of its own put the
  // groups wherever the first per-group section fell. That is where it goes
  // back, rather than to its canonical place, which could be pages away.
  if (!placed.has('GROUPS')) {
    const first = layout.findIndex((id) => isSectionKey(id) && SECTION_META[id].perGroup);
    if (first >= 0) {
      layout.splice(first, 0, 'GROUPS');
      placed.add('GROUPS');
    }
  }

  for (const id of DEFAULT_LAYOUT) {
    if (placed.has(id) || !known.has(id)) continue;
    // Put it back beside the neighbour it has always sat next to rather than at
    // the end: a section added in a later version must not land underneath the
    // closing line of a report someone already signed off.
    const previous = DEFAULT_LAYOUT.slice(0, DEFAULT_LAYOUT.indexOf(id))
      .reverse()
      .find((key) => placed.has(key));
    layout.splice(previous ? layout.indexOf(previous) + 1 : 0, 0, id);
    placed.add(id);
  }

  for (const block of blocks) {
    if (placed.has(block.id)) continue;
    placed.add(block.id);
    layout.push(block.id);
  }

  // Deleted parts and dragged group order name things that come and go with the
  // data - a department, a shed - so an id that matches nothing today is kept
  // rather than dropped. It may well match again next month.
  const stringList = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))]
      : [];

  return {
    config: {
      version: 1,
      title: input.title ?? base.title,
      intro: input.intro ?? base.intro,
      departmentIds: input.departmentIds ?? base.departmentIds,
      locationIds: input.locationIds ?? base.locationIds,
      categoryIds: input.categoryIds ?? base.categoryIds,
      statuses: input.statuses ?? base.statuses,
      search: input.search ?? base.search,
      purchaseStatuses: input.purchaseStatuses ?? base.purchaseStatuses,
      purchasePriorities: input.purchasePriorities ?? base.purchasePriorities,
      fixesRequireVideo: input.fixesRequireVideo ?? base.fixesRequireVideo,
      orientation: input.orientation ?? base.orientation,
      groupBy: input.groupBy ?? base.groupBy,
      pageBreakPerGroup: input.pageBreakPerGroup ?? base.pageBreakPerGroup,
      sections,
      blocks,
      layout,
      hiddenBlocks: stringList(input.hiddenBlocks),
      groupOrder: stringList(input.groupOrder),
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// The flow
//
// One flat, ordered list of everything on the page. The canvas addresses each
// item by its id, the template walks the list to render, and both work from
// this function so what is dragged on screen is what prints.
// ---------------------------------------------------------------------------

export type FlowItem =
  | { kind: 'BUILTIN'; id: string; label: string }
  | { kind: 'SECTION'; id: ReportSectionKey; label: string; section: NormalizedSection }
  | { kind: 'BLOCK'; id: string; label: string; block: NormalizedBlock };

export function flowItems(config: NormalizedReportConfig): FlowItem[] {
  const sectionById = new Map(config.sections.map((section) => [section.key as string, section]));
  const blockById = new Map(config.blocks.map((block) => [block.id, block]));

  const items: FlowItem[] = [];

  for (const id of config.layout) {
    const builtin = BUILTIN_BLOCKS[id];
    if (builtin) {
      items.push({ kind: 'BUILTIN', id, label: builtin.label });
      continue;
    }

    const section = sectionById.get(id);
    if (section) {
      items.push({
        kind: 'SECTION',
        id: section.key,
        label: SECTION_META[section.key].label,
        section,
      });
      continue;
    }

    const block = blockById.get(id);
    if (block) {
      items.push({
        kind: 'BLOCK',
        id: block.id,
        label: blockLabel(block),
        block,
      });
    }
  }

  return items;
}

/** What the canvas and the layers list call an added block. */
export function blockLabel(block: NormalizedBlock): string {
  const words = (block.text ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return BLOCK_TYPE_LABELS[block.type];
  const summary = words.slice(0, 5).join(' ');
  return summary.length > 40 ? `${summary.slice(0, 39)}…` : summary;
}

/** Was this part taken off the page with the ✕ on the canvas? */
export function isHidden(config: NormalizedReportConfig, id: string): boolean {
  return config.hiddenBlocks.includes(id);
}

/**
 * The sections that will actually render, in the order they sit in the layout.
 *
 * Order comes from the layout rather than from the sections array: a section
 * and an added text block can be dragged past one another, so there is only one
 * list that knows what comes first.
 */
export function enabledSections(config: NormalizedReportConfig): NormalizedSection[] {
  return flowItems(config)
    .filter(
      (item): item is Extract<FlowItem, { kind: 'SECTION' }> =>
        item.kind === 'SECTION' && item.section.enabled && !isHidden(config, item.id),
    )
    .map((item) => item.section);
}

/**
 * The blocks that render at the top level of the page, in order.
 *
 * The per-group sections are left out: they repeat inside every group, and the
 * run of groups itself is the `GROUPS` block.
 */
export function topLevelFlow(config: NormalizedReportConfig): FlowItem[] {
  return flowItems(config).filter(
    (item) => !(item.kind === 'SECTION' && SECTION_META[item.id].perGroup),
  );
}

/** The sections that repeat inside every group, in the order they sit in. */
export function perGroupSections(config: NormalizedReportConfig): NormalizedSection[] {
  return enabledSections(config).filter((section) => SECTION_META[section.key].perGroup);
}

/**
 * The groups in the order they were dragged into, with anything unlisted
 * following in the order the data produced. Group keys are department and
 * location ids, so a stored order is always partial.
 */
export function orderGroups<T extends { key: string }>(
  config: NormalizedReportConfig,
  groups: T[],
): T[] {
  if (config.groupOrder.length === 0) return groups;

  const rank = new Map(config.groupOrder.map((key, index) => [key, index]));
  return [...groups].sort((a, b) => {
    const left = rank.get(a.key);
    const right = rank.get(b.key);
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  });
}

export function findSection(
  config: NormalizedReportConfig,
  key: ReportSectionKey,
): NormalizedSection | undefined {
  return config.sections.find((section) => section.key === key);
}

export function sectionIsOn(config: NormalizedReportConfig, key: ReportSectionKey): boolean {
  return (findSection(config, key)?.enabled ?? false) && !isHidden(config, key);
}
