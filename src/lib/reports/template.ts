import 'server-only';
import type { AssetStatus } from '@prisma/client';
import type {
  ReportData,
  ReportGroup,
  StatusCounts,
  ReportAssetRow,
  ReportPurchaseRow,
  ReportFixRow,
} from '@/lib/reports/data';
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUS_ORDER,
  PURCHASE_PRIORITY_LABELS,
  PURCHASE_KIND_LABELS,
  formatMoney,
  formatDate,
  formatDateTime,
} from '@/lib/format';
import {
  COLUMN_SETS,
  solveColumnWidths,
  usableWidthPx,
  type ColumnMeta,
  type AssetColumnKey,
  type PurchaseColumnKey,
  type FixColumnKey,
} from '@/lib/reports/columns';
import {
  SECTION_META,
  blockLabel,
  isHidden,
  orderGroups,
  perGroupSections,
  topLevelFlow,
  type NormalizedBlock,
  type NormalizedColumn,
  type NormalizedSection,
} from '@/lib/reports/config';
import { CANVAS_SCRIPT, CANVAS_STYLES } from '@/lib/reports/canvas';

/**
 * The CEO-facing document.
 *
 * Everything here is hand-laid-out HTML/CSS rather than a charting or reporting
 * library, because the requirement is a document that looks identical every time
 * - same margins, same column widths, same page breaks - regardless of how much
 * data lands in it. Rules that keep it stable:
 *
 *  - No web fonts, no remote images, no scripts. Puppeteer renders with
 *    setContent and no network, so anything external would silently vanish.
 *  - Every table repeats its header across pages and never splits a row.
 *  - Section headings are glued to the content beneath them, so a heading can
 *    never end up stranded alone at the foot of a page.
 *  - Money is tabular-figure aligned so columns of numbers line up.
 *  - Every colgroup sums to exactly 100, and no column that cannot wrap is
 *    narrower than its widest possible content. `table-layout: fixed` does not
 *    grow a column to fit: a nowrap cell that is too wide simply draws over the
 *    next one. That arithmetic is no longer written into each table by hand -
 *    the columns are chosen in the builder now, so `solveColumnWidths` in
 *    reports/columns.ts does it from the measurements each column carries.
 *
 * The same function renders the on-screen preview, with `meta.isPreview` adding
 * a paper frame and the running header and footer that Puppeteer otherwise
 * draws into the page margins. One renderer, so what the builder shows and what
 * the PDF contains cannot drift apart.
 */

// ---------------------------------------------------------------------------
// Escaping - every value below comes from user input.
// ---------------------------------------------------------------------------

function esc(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes a URL and refuses anything that is not http(s). */
function escUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return esc(url.toString());
  } catch {
    return '';
  }
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

const dash = '<span class="muted">-</span>';

function orDash(value: string | null | undefined): string {
  return value && value.trim() !== '' ? esc(value) : dash;
}

// ---------------------------------------------------------------------------
// Canvas handles
//
// The attributes the editor grabs a block by. They are written only into an
// editable preview: a printed document carries no trace of how it was laid out,
// and the PDF is byte-for-byte what it was before the canvas existed.
// ---------------------------------------------------------------------------

type BlockKind = 'flow' | 'group' | 'part';

function handle(data: ReportData, id: string, kind: BlockKind, label: string): string {
  if (!data.meta.editable) return '';
  return ` data-b="${esc(id)}" data-bk="${kind}" data-bl="${esc(label)}"`;
}

/** Marks text that can be typed over on the page itself. */
function typeable(data: ReportData, id: string, field: string): string {
  if (!data.meta.editable) return '';
  return ` data-btext="${esc(id)}" data-bfield="${esc(field)}"`;
}

/** Was this part taken off the page with the ✕ on the canvas? */
function removed(data: ReportData, id: string): boolean {
  return isHidden(data.meta.config, id);
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

const STATUS_CLASS: Record<AssetStatus, string> = {
  IN_USE: 'ok',
  IDLE: 'idle',
  NEEDS_REPLACEMENT: 'warn',
  BROKEN: 'bad',
};

function statusPill(status: AssetStatus): string {
  return `<span class="pill pill-${STATUS_CLASS[status]}">${esc(ASSET_STATUS_LABELS[status])}</span>`;
}

function priorityPill(priority: ReportPurchaseRow['priority']): string {
  const cls =
    priority === 'CRITICAL' ? 'bad' : priority === 'HIGH' ? 'warn' : priority === 'MEDIUM' ? 'idle' : 'neutral';
  return `<span class="pill pill-${cls}">${esc(PURCHASE_PRIORITY_LABELS[priority])}</span>`;
}

function purchaseStatusPill(status: ReportPurchaseRow['status']): string {
  // Labels stay short deliberately: the pill is nowrap and the column is
  // measured against these words.
  if (status === 'APPROVED') return '<span class="pill pill-ok">Approved</span>';
  if (status === 'REJECTED') return '<span class="pill pill-bad">Rejected</span>';
  return '<span class="pill pill-neutral">Pending</span>';
}

/**
 * Asset thumbnail.
 *
 * The src is always a base64 data URI produced in data.ts - never a URL. The
 * report is rendered with network access blocked, so a remote src would show as
 * a broken image in a document going to the CEO.
 */
function photoCell(dataUri: string | null): string {
  if (!dataUri) return '<div class="thumb thumb-empty"></div>';
  // Attribute-quoted data URI; base64 contains no quotes so it is safe as-is.
  return `<img class="thumb" src="${dataUri}" alt="">`;
}

function kpi(label: string, value: string, note: string, attrs: string): string {
  return `
    <div class="kpi"${attrs}>
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${value}</div>
      ${note ? `<div class="kpi-note">${esc(note)}</div>` : ''}
    </div>`;
}

/**
 * Stacked status bar, drawn in pure CSS.
 *
 * A real chart library would be a liability here: this has to render identically
 * in a headless browser at print resolution, with no JS execution timing to wait
 * on. Percentages are rounded so the segments always total exactly 100%.
 */
function statusBar(counts: StatusCounts, total: number): string {
  if (total === 0) {
    return `<div class="bar bar-empty"><span>No assets recorded</span></div>`;
  }

  const present = ASSET_STATUS_ORDER.filter((s) => counts[s] > 0);

  // Distribute rounding error onto the largest segment so the bar never shows a
  // hairline gap or overflows onto a second line.
  const raw = present.map((s) => (counts[s] / total) * 100);
  const rounded = raw.map((v) => Math.round(v * 10) / 10);
  const drift = 100 - rounded.reduce((a, b) => a + b, 0);
  if (present.length > 0) {
    const largest = rounded.indexOf(Math.max(...rounded));
    rounded[largest] = Math.round((rounded[largest] + drift) * 10) / 10;
  }

  const segments = present
    .map(
      (status, i) =>
        `<div class="bar-seg seg-${STATUS_CLASS[status]}" style="width:${rounded[i]}%"></div>`,
    )
    .join('');

  const legend = ASSET_STATUS_ORDER.map(
    (status) => `
      <div class="legend-item${counts[status] === 0 ? ' legend-zero' : ''}">
        <span class="legend-dot dot-${STATUS_CLASS[status]}"></span>
        <span class="legend-label">${esc(ASSET_STATUS_LABELS[status])}</span>
        <span class="legend-count">${counts[status]}</span>
      </div>`,
  ).join('');

  return `
    <div class="bar">${segments}</div>
    <div class="legend">${legend}</div>`;
}

// ---------------------------------------------------------------------------
// Cells
//
// One entry per column in the registry, and TypeScript requires the record to
// be complete: a column added to reports/columns.ts without a renderer here is
// a typecheck failure rather than a blank column in a document going to the CEO.
//
// `chosen` is the set of columns this table is showing. A few cells fold a
// second field in underneath - the asset note under its name, the justification
// under the request - and step aside when that field has been given a column of
// its own, so nothing is ever printed twice.
// ---------------------------------------------------------------------------

type CellDef<Row> = {
  /** Extra classes on the td, beyond the alignment the column meta implies. */
  className?: string;
  render: (row: Row, chosen: Set<string>) => string;
};

const ASSET_CELLS: Record<AssetColumnKey, CellDef<ReportAssetRow>> = {
  photo: { className: 'photo-cell', render: (row) => photoCell(row.photoDataUri) },
  assetTag: { className: 'mono tag-cell', render: (row) => esc(row.assetTag) },
  name: {
    render: (row, chosen) =>
      `<span class="strong">${esc(row.name)}</span>` +
      (row.notes && !chosen.has('notes')
        ? `<div class="sub">${esc(truncate(row.notes, 90))}</div>`
        : ''),
  },
  category: { render: (row) => esc(row.category) },
  department: { render: (row) => esc(row.department) },
  location: { render: (row) => orDash(row.location) },
  status: { className: 'nowrap', render: (row) => statusPill(row.status) },
  serialNumber: { className: 'mono', render: (row) => orDash(row.serialNumber) },
  purchaseDate: { className: 'nowrap', render: (row) => esc(formatDate(row.purchaseDate)) },
  purchaseCost: {
    className: 'nowrap',
    render: (row) => (row.purchaseCost === null ? dash : esc(formatMoney(row.purchaseCost))),
  },
  fixCount: { render: (row) => (row.fixCount > 0 ? String(row.fixCount) : dash) },
  notes: { render: (row) => (row.notes ? esc(truncate(row.notes, 200)) : dash) },
};

const PURCHASE_CELLS: Record<PurchaseColumnKey, CellDef<ReportPurchaseRow>> = {
  title: {
    render: (row, chosen) => {
      const replaces =
        row.replacesAssetTag && !chosen.has('replaces')
          ? `<div class="sub">Replaces ${esc(row.replacesAssetTag)} · ${esc(truncate(row.replacesAssetName ?? '', 40))}</div>`
          : '';
      const why = chosen.has('justification')
        ? ''
        : `<div class="sub">${esc(truncate(row.justification, 180))}</div>`;
      return `<span class="strong">${esc(row.title)}</span>${replaces}${why}`;
    },
  },
  category: { render: (row) => esc(row.category) },
  department: { render: (row) => esc(row.department) },
  kind: { className: 'nowrap', render: (row) => esc(PURCHASE_KIND_LABELS[row.kind]) },
  quantity: { render: (row) => String(row.quantity) },
  estimatedCost: {
    className: 'nowrap',
    render: (row) => (row.estimatedCost === null ? dash : esc(formatMoney(row.estimatedCost))),
  },
  lineTotal: {
    className: 'nowrap strong',
    render: (row) => (row.lineTotal === null ? dash : esc(formatMoney(row.lineTotal))),
  },
  priority: { className: 'nowrap', render: (row) => priorityPill(row.priority) },
  status: { className: 'nowrap', render: (row) => purchaseStatusPill(row.status) },
  requestedByName: { render: (row) => esc(row.requestedByName) },
  requestedAt: { className: 'nowrap', render: (row) => esc(formatDate(row.requestedAt)) },
  replaces: {
    render: (row) =>
      row.replacesAssetTag
        ? `<span class="mono">${esc(row.replacesAssetTag)}</span><div class="sub">${esc(truncate(row.replacesAssetName ?? '', 40))}</div>`
        : dash,
  },
  justification: { render: (row) => esc(truncate(row.justification, 240)) },
};

const FIX_CELLS: Record<FixColumnKey, CellDef<ReportFixRow>> = {
  assetTag: { className: 'mono tag-cell', render: (row) => esc(row.assetTag) },
  title: {
    render: (row, chosen) =>
      `<span class="strong">${esc(row.title)}</span>` +
      (chosen.has('assetName') ? '' : `<div class="sub">${esc(row.assetName)}</div>`),
  },
  assetName: { render: (row) => esc(row.assetName) },
  department: { render: (row) => esc(row.department) },
  fixedByName: { render: (row) => esc(row.fixedByName) },
  fixedAt: { className: 'nowrap', render: (row) => esc(formatDate(row.fixedAt)) },
  symptom: { render: (row) => (row.symptom ? esc(truncate(row.symptom, 160)) : dash) },
  video: {
    className: 'nowrap',
    render: (row) => {
      const url = row.videoUrl ? escUrl(row.videoUrl) : '';
      return url ? `<a class="video-link" href="${url}">Watch repair video</a>` : dash;
    },
  },
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** The content box this document is being laid out against. */
function pageWidth(data: ReportData): number {
  return usableWidthPx(data.meta.config.orientation);
}

type TableOptions<Row> = {
  columns: NormalizedColumn[];
  set: Record<string, ColumnMeta>;
  cells: Record<string, CellDef<Row>>;
  rows: Row[];
  /** Shown in place of the table when there is nothing in it. */
  empty: string;
  /** Optional summary row, given the columns actually rendered. */
  foot?: (keys: string[], rows: Row[]) => string;
  /** The content box the colgroup is solved against - the page can be turned. */
  usablePx: number;
  /** Which section's columns these are, so the canvas knows what it is editing. */
  tableKey: string;
  /** Which tick list a row struck out on the canvas belongs to. */
  rowKind: 'asset' | 'purchase' | 'fix';
  rowId: (row: Row) => string;
  editable: boolean;
};

function dataTable<Row>(options: TableOptions<Row>): string {
  if (options.rows.length === 0) return `<p class="empty">${esc(options.empty)}</p>`;

  const solved = solveColumnWidths(
    options.columns.map((column) => column.key),
    options.set,
    Object.fromEntries(
      options.columns
        .filter((column) => column.width !== undefined)
        .map((column) => [column.key, column.width as number]),
    ),
    options.usablePx,
  );

  if (!solved.ok) {
    // Only reachable if a setup got past the builder, which refuses to save a
    // table that cannot fit. Say so in the document rather than printing a
    // table with columns lying on top of each other.
    return `<p class="notice">${esc(solved.error)}</p>`;
  }

  const keys = solved.columns.map((column) => column.key);
  const chosen = new Set(keys);

  const colgroup = solved.columns
    .map((column) => `<col style="width:${column.percent}%">`)
    .join('');

  const head = solved.columns
    .map((column) => {
      // The floor travels with the header so the canvas can enforce it while a
      // divider is being dragged, rather than only when the drag is let go.
      const edit = options.editable
        ? ` data-col="${esc(column.key)}" data-min="${Math.ceil((column.meta.hardPx / options.usablePx) * 100)}"`
        : '';
      return `<th${column.meta.num ? ' class="num"' : ''}${edit}>${
        column.meta.headerless ? '' : esc(column.meta.label)
      }</th>`;
    })
    .join('');

  const body = options.rows
    .map((row) => {
      const cells = solved.columns
        .map((column) => {
          const def = options.cells[column.key];
          const className = [column.meta.num ? 'num' : '', def.className ?? '']
            .filter(Boolean)
            .join(' ');
          return `<td${className ? ` class="${className}"` : ''}>${def.render(row, chosen)}</td>`;
        })
        .join('');
      const edit = options.editable
        ? ` data-row="${esc(options.rowId(row))}" data-rowkind="${options.rowKind}"`
        : '';
      return `<tr${edit}>${cells}</tr>`;
    })
    .join('');

  return `
    <table class="data"${options.editable ? ` data-tbl="${esc(options.tableKey)}"` : ''}>
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
      ${options.foot ? options.foot(keys, options.rows) : ''}
    </table>`;
}

function assetTable(
  data: ReportData,
  tableKey: string,
  columns: NormalizedColumn[],
  rows: ReportAssetRow[],
  empty: string,
): string {
  return dataTable({
    columns,
    set: COLUMN_SETS.asset,
    cells: ASSET_CELLS,
    rows,
    empty,
    usablePx: pageWidth(data),
    tableKey,
    rowKind: 'asset',
    rowId: (row) => row.id,
    editable: data.meta.editable,
  });
}

function purchaseTable(
  data: ReportData,
  columns: NormalizedColumn[],
  rows: ReportPurchaseRow[],
): string {
  return dataTable({
    columns,
    set: COLUMN_SETS.purchase,
    cells: PURCHASE_CELLS,
    rows,
    usablePx: pageWidth(data),
    tableKey: 'PURCHASES',
    rowKind: 'purchase',
    rowId: (row) => row.id,
    editable: data.meta.editable,
    empty: 'No outstanding purchase needs flagged.',
    /**
     * The estimated total, placed under whichever column holds the line totals.
     * Built from the rendered columns rather than a fixed colspan, because the
     * table no longer has a fixed shape.
     */
    foot: (keys, purchases) => {
      const totalIndex = keys.indexOf('lineTotal');
      if (totalIndex < 1) return '';

      const knownTotal = purchases.reduce((sum, p) => sum + (p.lineTotal ?? 0), 0);
      const unknown = purchases.filter((p) => p.lineTotal === null).length;

      const cells = keys.map((key, i) => {
        if (i === 0) return '<td class="num strong">Estimated total</td>';
        if (i === totalIndex) return `<td class="num strong">${esc(formatMoney(knownTotal))}</td>`;
        if (i === totalIndex + 1 && unknown > 0) {
          return `<td class="sub">${esc(`${unknown} without an estimate`)}</td>`;
        }
        return '<td></td>';
      });

      return `<tfoot><tr>${cells.join('')}</tr></tfoot>`;
    },
  });
}

function fixTable(data: ReportData, columns: NormalizedColumn[], rows: ReportFixRow[]): string {
  return dataTable({
    columns,
    set: COLUMN_SETS.fix,
    cells: FIX_CELLS,
    rows,
    empty: 'No repairs recorded.',
    usablePx: pageWidth(data),
    tableKey: 'FIXES',
    rowKind: 'fix',
    rowId: (row) => row.id,
    editable: data.meta.editable,
  });
}

// ---------------------------------------------------------------------------
// Page sections
// ---------------------------------------------------------------------------

/**
 * No logo mark, by request - the company name is the identity here. That covers
 * the image and the two-letter badge that used to stand in for it; a badge is
 * still a logo, so leaving it would only have swapped one for the other.
 */
function masthead(data: ReportData): string {
  const { meta } = data;

  return `
    <header class="masthead"${handle(data, 'MASTHEAD', 'flow', 'Letterhead')}>
      <div class="masthead-id">
        <div class="company">${esc(meta.companyName)}</div>
        <div class="tagline">${esc(meta.tagline)}</div>
      </div>
      ${
        removed(data, 'MASTHEAD:right')
          ? ''
          : `<div class="masthead-right"${handle(data, 'MASTHEAD:right', 'part', 'Report type and date')}>
               <div class="doc-type">Internal report</div>
               <div class="doc-date">${esc(formatDate(meta.generatedAt))}</div>
             </div>`
      }
    </header>`;
}

/** What the filters narrowed this document to, in words. */
function filterSummary(data: ReportData): string {
  const { config } = data.meta;
  const parts: string[] = [];

  parts.push(
    config.statuses.length > 0
      ? config.statuses.map((status) => ASSET_STATUS_LABELS[status]).join(', ')
      : 'All conditions',
  );
  if (config.locationIds.length > 0) parts.push(`${config.locationIds.length} location(s)`);
  if (config.categoryIds.length > 0) parts.push(`${config.categoryIds.length} category(s)`);
  if (config.search) parts.push(`matching "${config.search}"`);

  return parts.join(' · ');
}

function titleBlock(data: ReportData): string {
  const { meta, totals } = data;

  // An opening note that has not been written yet still gets a paragraph on the
  // canvas, so it can be typed into where it will print rather than found in a
  // field somewhere else. Nothing is emitted for the PDF.
  const intro = meta.config.intro
    ? `<p class="lede"${typeable(data, 'TITLE', 'intro')}>${esc(meta.config.intro)}</p>`
    : meta.editable
      ? `<p class="lede rc-empty"${typeable(data, 'TITLE', 'intro')}></p>`
      : '';

  return `
    <section class="title-block"${handle(data, 'TITLE', 'flow', 'Title block')}>
      <h1${typeable(data, 'TITLE', 'title')}>${esc(meta.title)}</h1>
      ${removed(data, 'TITLE:scope') ? '' : `<div class="scope"${handle(data, 'TITLE:scope', 'part', 'What it covers')}>${esc(meta.scopeLabel)}</div>`}
      ${intro}
      ${
        removed(data, 'TITLE:meta')
          ? ''
          : `<dl class="meta-grid"${handle(data, 'TITLE:meta', 'part', 'Report details')}>
              <div><dt>Generated</dt><dd>${esc(formatDateTime(meta.generatedAt))}</dd></div>
              <div><dt>Prepared by</dt><dd>${esc(meta.generatedByName)} · ${esc(meta.generatedByRole)}</dd></div>
              <div><dt>Coverage</dt><dd>${totals.assetCount} asset${totals.assetCount === 1 ? '' : 's'} · grouped by ${esc(meta.groupByLabel)}</dd></div>
              <div><dt>Filter</dt><dd>${esc(filterSummary(data))}</dd></div>
            </dl>`
      }
    </section>`;
}

function executiveSummary(data: ReportData): string {
  const { totals } = data;
  const needsAttention = totals.statusCounts.BROKEN + totals.statusCounts.NEEDS_REPLACEMENT;

  const tiles = [
    {
      id: 'tracked',
      label: 'Assets tracked',
      value: String(totals.assetCount),
      note: `across ${totals.departmentCount} department${totals.departmentCount === 1 ? '' : 's'}`,
    },
    {
      id: 'attention',
      label: 'Need attention',
      value: String(needsAttention),
      note: 'broken or due for replacement',
    },
    {
      id: 'awaiting',
      label: 'Awaiting decision',
      value: String(totals.pendingPurchaseCount),
      note: 'purchase requests',
    },
    {
      id: 'spend',
      label: 'Estimated spend',
      value: formatMoney(totals.pendingPurchaseEstimate),
      note: 'if all pending approved',
    },
  ].filter((tile) => !removed(data, `SUMMARY:kpi:${tile.id}`));

  return `
    <section class="section keep-together"${handle(data, 'SUMMARY', 'flow', 'Executive summary')}>
      <h2>Executive summary</h2>

      ${
        tiles.length === 0
          ? ''
          : `<div class="kpi-row">${tiles
              .map((tile) =>
                kpi(
                  tile.label,
                  tile.value,
                  tile.note,
                  handle(data, `SUMMARY:kpi:${tile.id}`, 'part', tile.label),
                ),
              )
              .join('')}</div>`
      }

      ${
        removed(data, 'SUMMARY:chart')
          ? ''
          : `<div class="chart-block"${handle(data, 'SUMMARY:chart', 'part', 'Condition bar')}>
              <div class="chart-title">Condition of tracked assets</div>
              ${statusBar(totals.statusCounts, totals.assetCount)}
            </div>`
      }

      ${
        removed(data, 'SUMMARY:value')
          ? ''
          : `<div class="value-note"${handle(data, 'SUMMARY:value', 'part', 'Recorded value line')}>
              Recorded purchase value of tracked assets:
              <strong>${esc(formatMoney(totals.knownValue))}</strong>${
                totals.assetsWithUnknownCost > 0
                  ? ` <span class="muted">(${totals.assetsWithUnknownCost} asset${totals.assetsWithUnknownCost === 1 ? '' : 's'} with no recorded cost are excluded)</span>`
                  : ''
              }
            </div>`
      }
    </section>`;
}

/** The single list the CEO is most likely to act from. */
function attentionSection(data: ReportData, section: NormalizedSection): string {
  if (data.attention.length === 0) return '';

  const shown = data.attention.slice(0, 25);

  return `
    <section class="section"${handle(data, 'ATTENTION', 'flow', 'Needs attention')}>
      <h2>Equipment requiring a decision</h2>
      <p class="lede">Assets currently broken or flagged for replacement, most severe first.</p>
      ${assetTable(data, 'ATTENTION', section.columns, shown, 'Nothing needs attention.')}
      ${
        data.attention.length > shown.length
          ? `<p class="sub">Showing the first ${shown.length} of ${data.attention.length}. The full list appears in the sections that follow.</p>`
          : ''
      }
    </section>`;
}

function fixNotice(data: ReportData): string {
  return data.meta.videoLinksArePublic
    ? ''
    : `<p class="notice">These links currently resolve to the office network address, so they will only open from inside the office. Configure PUBLIC_VIDEO_BASE_URL once the Cloudflare Tunnel is live to make them work off-site.</p>`;
}

/** The per-group sections, in the order they were dragged into. */
function groupBody(group: ReportGroup, data: ReportData, sections: NormalizedSection[]): string {
  return sections
    .map((section) => {
      const id = `group:${group.key}:${section.key}`;
      if (removed(data, id)) return '';
      const attrs = handle(data, id, 'part', `${group.label} · ${SECTION_META[section.key].label}`);

      if (section.key === 'ASSETS') {
        return `<div class="subsection"${attrs}>
            <h3>Assets</h3>
            ${assetTable(data, 'ASSETS', section.columns, group.assets, 'No assets recorded here.')}
          </div>`;
      }
      if (section.key === 'PURCHASES') {
        if (group.purchases.length === 0) return '';
        return `<div class="subsection"${attrs}>
            <h3>Flagged purchase needs</h3>
            ${purchaseTable(data, section.columns, group.purchases)}
          </div>`;
      }
      if (section.key === 'FIXES') {
        if (group.fixes.length === 0) return '';
        return `<div class="subsection"${attrs}>
            <h3>Repair history</h3>
            ${fixNotice(data)}
            ${fixTable(data, section.columns, group.fixes)}
          </div>`;
      }
      return '';
    })
    .join('');
}

function groupSection(
  group: ReportGroup,
  data: ReportData,
  sections: NormalizedSection[],
  breakBefore: boolean,
): string {
  const needsAttention = group.statusCounts.BROKEN + group.statusCounts.NEEDS_REPLACEMENT;

  // Grouped by nothing, there is one block holding everything and a heading
  // saying "All records" would be noise.
  const header =
    data.meta.config.groupBy === 'NONE' || removed(data, `group:${group.key}:header`)
      ? ''
      : `<div class="group-header keep-together"${handle(data, `group:${group.key}:header`, 'part', `${group.label} heading`)}>
          <div class="group-title">
            <h2>${esc(group.label)}</h2>
            ${group.code ? `<span class="code-chip">${esc(group.code)}</span>` : ''}
          </div>
          ${group.description ? `<p class="lede">${esc(group.description)}</p>` : ''}
          ${group.subtitle ? `<p class="sub">${esc(group.subtitle)}</p>` : ''}

          ${
            removed(data, `group:${group.key}:stats`)
              ? ''
              : `<div class="group-stats"${handle(data, `group:${group.key}:stats`, 'part', 'Group figures')}>
                  <div class="group-stat"><span class="n">${group.assetCount}</span><span class="l">Assets</span></div>
                  <div class="group-stat"><span class="n">${needsAttention}</span><span class="l">Need attention</span></div>
                  <div class="group-stat"><span class="n">${group.pendingPurchaseCount}</span><span class="l">Requests pending</span></div>
                  <div class="group-stat"><span class="n">${esc(formatMoney(group.pendingPurchaseEstimate))}</span><span class="l">Estimated spend</span></div>
                </div>`
          }

          ${
            removed(data, `group:${group.key}:chart`)
              ? ''
              : `<div class="chart-block compact"${handle(data, `group:${group.key}:chart`, 'part', 'Condition bar')}>
                  ${statusBar(group.statusCounts, group.assetCount)}
                </div>`
          }
        </div>`;

  return `
    <section class="section group${breakBefore ? ' page-break' : ''}"${handle(data, `group:${group.key}`, 'group', group.label)}>
      ${header}
      ${groupBody(group, data, sections)}
    </section>`;
}

/**
 * Purchase requests and repairs the grouping could not place.
 *
 * A purchase request belongs to a department and to nothing else - it describes
 * equipment that does not exist yet, so it has no shed and no condition. Rather
 * than repeat every request under every location, they are collected here once.
 */
function ungroupedSection(data: ReportData, sections: NormalizedSection[]): string {
  const purchaseSection = sections.find((section) => section.key === 'PURCHASES');
  const fixSection = sections.find((section) => section.key === 'FIXES');

  const blocks: string[] = [];

  if (
    purchaseSection &&
    data.ungrouped.purchases.length > 0 &&
    !removed(data, 'ungrouped:PURCHASES')
  ) {
    blocks.push(`
      <div class="subsection"${handle(data, 'ungrouped:PURCHASES', 'part', 'Purchase requests')}>
        <h3>Flagged purchase needs</h3>
        <p class="sub">Requests are recorded against a department, so they are listed once rather than under each ${esc(data.meta.groupByLabel)}.</p>
        ${purchaseTable(data, purchaseSection.columns, data.ungrouped.purchases)}
      </div>`);
  }

  if (fixSection && data.ungrouped.fixes.length > 0 && !removed(data, 'ungrouped:FIXES')) {
    blocks.push(`
      <div class="subsection"${handle(data, 'ungrouped:FIXES', 'part', 'Repair history')}>
        <h3>Repair history</h3>
        ${fixNotice(data)}
        ${fixTable(data, fixSection.columns, data.ungrouped.fixes)}
      </div>`);
  }

  if (blocks.length === 0) return '';

  return `<section class="section${data.meta.config.pageBreakPerGroup ? ' page-break' : ''}">${blocks.join('')}</section>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/** The whole run of groups, which is one block on the page. */
function groupsRun(
  data: ReportData,
  sections: NormalizedSection[],
  somethingAbove: boolean,
): string {
  if (sections.length === 0) return '';

  const groups = orderGroups(data.meta.config, data.groups).filter(
    (group) => !removed(data, `group:${group.key}`),
  );

  const run =
    groups
      .map((group, i) =>
        groupSection(
          group,
          data,
          sections,
          // A break before the first group only when something precedes it on
          // the page; otherwise the document would open on a blank sheet.
          data.meta.config.pageBreakPerGroup ? i > 0 || somethingAbove : false,
        ),
      )
      .join('') + ungroupedSection(data, sections);

  // On the canvas only: an unstyled wrapper, so the whole run of groups can be
  // grabbed, dragged and taken off as one block. The PDF gets the groups on
  // their own exactly as before - nothing in the printed document depends on
  // this div existing.
  return data.meta.editable
    ? `<div class="groups-run"${handle(data, 'GROUPS', 'flow', `Equipment by ${data.meta.groupByLabel}`)}>${run}</div>`
    : run;
}

function endNote(data: ReportData): string {
  return `
    <section class="end-note"${handle(data, 'ENDNOTE', 'flow', 'Closing line')}>
      <p>End of report · ${esc(data.meta.companyName)} · Generated ${esc(formatDateTime(data.meta.generatedAt))}</p>
    </section>`;
}

/** A block someone added to the page themselves. */
function addedBlock(data: ReportData, block: NormalizedBlock): string {
  const attrs = handle(data, block.id, 'flow', blockLabel(block));

  // A forced break carries no content. In the preview the dashed "new page"
  // rule the sheet already draws is what makes it visible and grabbable.
  if (block.type === 'BREAK') {
    return `<div class="added added-break page-break"${attrs}></div>`;
  }
  if (block.type === 'SPACER') {
    return `<div class="added added-spacer" style="height:${block.height}px"${attrs}></div>`;
  }
  if (block.type === 'DIVIDER') {
    return `<div class="added added-divider"${attrs}></div>`;
  }

  const text = block.text ?? '';
  const empty = text.trim() === '' && data.meta.editable ? ' rc-empty' : '';
  const tag = block.type === 'HEADING' ? 'h2' : 'p';
  const kind = block.type === 'HEADING' ? 'added-heading' : 'added-text';

  return `<${tag} class="added ${kind} al-${block.align.toLowerCase()} sz-${block.size.toLowerCase()}${empty}"${attrs}${typeable(
    data,
    block.id,
    'text',
  )}>${esc(text).replace(/\n/g, '<br>')}</${tag}>`;
}

export function renderReportHtml(data: ReportData): string {
  const { config } = data.meta;
  const perGroup = perGroupSections(config);

  const parts: string[] = [];

  // The page is one flat list of blocks, in the order they were dragged into.
  // Nothing decides its own position any more, which is what makes the canvas
  // and the printed document the same document.
  for (const item of topLevelFlow(config)) {
    if (removed(data, item.id)) continue;

    if (item.kind === 'BLOCK') {
      if (item.block.enabled) parts.push(addedBlock(data, item.block));
      continue;
    }

    if (item.kind === 'SECTION') {
      if (!item.section.enabled) continue;
      if (item.id === 'SUMMARY') parts.push(executiveSummary(data));
      if (item.id === 'ATTENTION') parts.push(attentionSection(data, item.section));
      continue;
    }

    if (item.id === 'MASTHEAD') parts.push(masthead(data));
    if (item.id === 'TITLE') parts.push(titleBlock(data));
    if (item.id === 'ENDNOTE') parts.push(endNote(data));
    if (item.id === 'GROUPS') {
      parts.push(groupsRun(data, perGroup, parts.some((part) => part !== '')));
    }
  }

  const body = parts.join('');

  // The preview is one continuous sheet rather than paginated pages: Chrome
  // only breaks a document into pages while printing it. What it can show is
  // the running header and footer Puppeteer draws into the margins, and where
  // each forced break falls - both of which are what someone laying a report
  // out actually needs to see.
  const page = data.meta.isPreview
    ? `<div class="preview-sheet">
         <div class="preview-band preview-top">${headerContent(data)}</div>
         <div class="preview-body">${body}</div>
         <div class="preview-band preview-bottom">${footerContent(data, true)}</div>
       </div>`
    : body;

  // The canvas chrome is the only script this document ever carries, and only
  // when the builder asked to edit on the page. Puppeteer renders with
  // `editable` false, so nothing here can reach the PDF.
  const editor = data.meta.editable
    ? `<script>${CANVAS_SCRIPT}</script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(data.meta.title)} - ${esc(data.meta.scopeLabel)}</title>
<style>${STYLES}${data.meta.isPreview ? previewStyles(pageWidth(data)) : ''}${data.meta.editable ? CANVAS_STYLES : ''}</style>
</head>
<body${data.meta.isPreview ? ' class="is-preview"' : ''}>${page}${editor}</body>
</html>`;
}

function headerContent(data: ReportData): string {
  return `
    <div style="display:flex;justify-content:space-between;">
      <span>${esc(data.meta.companyName)} · ${esc(data.meta.title)}</span>
      <span>${esc(data.meta.scopeLabel)}</span>
    </div>`;
}

function footerContent(data: ReportData, preview: boolean): string {
  const page = preview
    ? 'Page 1 of n'
    : 'Page <span class="pageNumber"></span> of <span class="totalPages"></span>';

  return `
    <div style="display:flex;justify-content:space-between;">
      <span>Confidential · internal use only</span>
      <span>Generated ${esc(formatDate(data.meta.generatedAt))}</span>
      <span>${page}</span>
    </div>`;
}

/** Running header/footer, rendered by Puppeteer into the page margins. */
export function renderHeaderTemplate(data: ReportData): string {
  return `
    <div style="width:100%;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:7.5pt;color:#8a94a6;padding:0 14mm;">
      <div style="border-bottom:0.5px solid #dfe4ec;padding-bottom:3px;">${headerContent(data)}</div>
    </div>`;
}

export function renderFooterTemplate(data: ReportData): string {
  return `
    <div style="width:100%;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:7.5pt;color:#8a94a6;padding:0 14mm;">
      <div style="border-top:0.5px solid #dfe4ec;padding-top:4px;">${footerContent(data, false)}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Preview-only styles
//
// Never reach the PDF: Puppeteer renders without them, so nothing here can
// change what prints. The sheet is exactly the 688px content box the PDF has,
// so a column that overflows on screen overflows on paper too.
// ---------------------------------------------------------------------------

function previewStyles(usablePx: number): string {
  return `
  body.is-preview {
    background: #eef1f6;
    padding: 18px 0 28px;
  }
  .preview-sheet {
    width: ${usablePx + 28}px;
    margin: 0 auto;
    background: #fff;
    box-shadow: 0 1px 3px rgba(16,32,46,.14), 0 8px 24px rgba(16,32,46,.08);
    border-radius: 2px;
  }
  .preview-band {
    font-size: 7.5pt;
    color: #8a94a6;
    padding: 10px 14px;
  }
  .preview-top { border-bottom: .5px solid #dfe4ec; }
  .preview-bottom { border-top: .5px solid #dfe4ec; }
  /* 688px of content plus 14px either side, matching the PDF's margins. */
  .preview-body { padding: 14px; }
  /* Where a new sheet would start. Not a real break - the preview scrolls. */
  .is-preview .page-break {
    border-top: 1px dashed #b8c2d4;
    margin-top: 22px;
    padding-top: 22px;
    position: relative;
  }
  .is-preview .page-break::before {
    content: 'new page';
    position: absolute;
    top: -7px;
    left: 0;
    background: #eef1f6;
    color: #8a94a6;
    font-size: 6.5pt;
    letter-spacing: .08em;
    text-transform: uppercase;
    padding: 0 6px;
  }
`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = `
  /* Only fonts guaranteed to exist on the host machine. A missing web font
     would silently reflow the entire document. */
  :root {
    --ink: #16202e;
    --ink-soft: #4a5768;
    --ink-muted: #8a94a6;
    --rule: #dfe4ec;
    --rule-soft: #eef1f6;
    --panel: #f7f9fc;
    --accent: #1b3a6b;

    --ok: #1f7a4d;
    --ok-bg: #e7f4ec;
    --idle: #8a6d1f;
    --idle-bg: #fbf2dc;
    --warn: #b3541e;
    --warn-bg: #fdeee2;
    --bad: #a4232b;
    --bad-bg: #fbe9ea;
    --neutral: #55617a;
    --neutral-bg: #eef1f6;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    /* Stated explicitly rather than relying on the renderer's default page
       colour, so the document is white in every viewer and on every printer. */
    background: #ffffff;
    font-family: 'Segoe UI', -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 9pt;
    line-height: 1.45;
    color: var(--ink);
    /* Without this, headless Chrome drops every background colour when printing,
       which would strip all the status pills and panels out of the PDF. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* --- Page-break discipline ------------------------------------------- */
  .page-break { break-before: page; }
  .keep-together { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  table { break-inside: auto; }
  tr { break-inside: avoid; break-after: auto; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }

  /* --- Masthead --------------------------------------------------------- */
  .masthead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--accent);
    margin-bottom: 22px;
  }
  .company { font-size: 13pt; font-weight: 650; letter-spacing: -.01em; line-height: 1.2; }
  .tagline { font-size: 8pt; color: var(--ink-muted); margin-top: 1px; }
  .masthead-right { text-align: right; }
  .doc-type {
    font-size: 7.5pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--ink-muted);
  }
  .doc-date { font-size: 8.5pt; color: var(--ink-soft); margin-top: 2px; }

  /* --- Title block ------------------------------------------------------ */
  .title-block { margin-bottom: 24px; }
  h1 { font-size: 21pt; font-weight: 650; letter-spacing: -.02em; margin: 0 0 3px; line-height: 1.15; }
  .scope { font-size: 11pt; color: var(--ink-soft); margin-bottom: 16px; }

  .meta-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 0; margin: 0; padding: 12px 0;
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
  }
  .meta-grid > div { padding-right: 14px; }
  .meta-grid dt {
    font-size: 7pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-muted); margin-bottom: 3px;
  }
  .meta-grid dd { margin: 0; font-size: 8.5pt; font-weight: 550; color: var(--ink); }

  /* --- Sections --------------------------------------------------------- */
  .section { margin-bottom: 26px; }
  h2 {
    font-size: 13pt; font-weight: 650; letter-spacing: -.01em;
    margin: 0 0 4px; padding-bottom: 5px; border-bottom: 1px solid var(--rule);
  }
  h3 {
    font-size: 8pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-muted); margin: 18px 0 7px;
  }
  .subsection { margin-top: 4px; }
  .lede { font-size: 9pt; color: var(--ink-soft); margin: 8px 0 12px; }
  .sub { font-size: 7.5pt; color: var(--ink-muted); line-height: 1.4; margin-top: 2px; }
  .muted { color: var(--ink-muted); }
  .strong { font-weight: 600; }
  .empty {
    font-size: 8.5pt; color: var(--ink-muted); font-style: italic;
    padding: 12px 14px; background: var(--panel); border-radius: 5px; margin: 0;
  }
  .notice {
    font-size: 7.5pt; color: var(--warn); background: var(--warn-bg);
    padding: 7px 10px; border-radius: 4px; margin: 0 0 8px;
  }

  /* --- KPIs ------------------------------------------------------------- */
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0 20px; }
  .kpi {
    background: var(--panel); border: 1px solid var(--rule-soft);
    border-radius: 6px; padding: 11px 12px;
  }
  .kpi-label {
    font-size: 7pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-muted); margin-bottom: 5px;
  }
  .kpi-value {
    font-size: 17pt; font-weight: 650; letter-spacing: -.02em; line-height: 1;
    font-variant-numeric: tabular-nums; color: var(--accent);
  }
  .kpi-note { font-size: 7pt; color: var(--ink-muted); margin-top: 4px; line-height: 1.3; }

  /* --- Status bar ------------------------------------------------------- */
  .chart-block { margin: 16px 0 14px; }
  .chart-block.compact { margin: 12px 0 4px; }
  .chart-title {
    font-size: 7pt; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    color: var(--ink-muted); margin-bottom: 7px;
  }
  .bar {
    display: flex; width: 100%; height: 15px; border-radius: 3px;
    overflow: hidden; background: var(--rule-soft);
  }
  .bar-empty {
    align-items: center; justify-content: center; height: 26px;
    font-size: 7.5pt; color: var(--ink-muted); font-style: italic;
  }
  .bar-seg { height: 100%; }
  .seg-ok { background: var(--ok); }
  .seg-idle { background: #c9a227; }
  .seg-warn { background: #d97b34; }
  .seg-bad { background: var(--bad); }

  .legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 8px; }
  .legend-item { display: flex; align-items: center; gap: 5px; font-size: 7.5pt; }
  .legend-zero { opacity: .45; }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .dot-ok { background: var(--ok); }
  .dot-idle { background: #c9a227; }
  .dot-warn { background: #d97b34; }
  .dot-bad { background: var(--bad); }
  .legend-label { color: var(--ink-soft); }
  .legend-count { font-weight: 650; font-variant-numeric: tabular-nums; }

  .value-note {
    font-size: 8.5pt; color: var(--ink-soft); padding-top: 10px;
    border-top: 1px solid var(--rule-soft);
  }

  /* --- Department header ------------------------------------------------ */
  .group-title { display: flex; align-items: center; gap: 9px; }
  .group-title h2 { border: 0; padding: 0; margin: 0; flex: 1; }
  .code-chip {
    font-size: 7.5pt; font-weight: 700; letter-spacing: .06em;
    background: var(--accent); color: #fff; padding: 2px 7px; border-radius: 3px;
  }
  .group .group-header { border-bottom: 1px solid var(--rule); padding-bottom: 12px; margin-bottom: 4px; }
  .group-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
  .group-stat {
    display: flex; flex-direction: column; padding: 8px 10px;
    background: var(--panel); border-radius: 5px;
  }
  .group-stat .n {
    font-size: 12pt; font-weight: 650; line-height: 1.1;
    font-variant-numeric: tabular-nums; color: var(--accent);
  }
  .group-stat .l {
    font-size: 6.5pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
    color: var(--ink-muted); margin-top: 3px;
  }

  /* --- Tables ----------------------------------------------------------- */
  table.data { width: 100%; border-collapse: collapse; font-size: 8pt; table-layout: fixed; }
  table.data th {
    text-align: left; font-size: 6.8pt; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; color: var(--ink-muted);
    padding: 6px 7px; border-bottom: 1px solid var(--rule);
    background: var(--panel);
  }
  table.data td {
    padding: 6px 7px; border-bottom: 1px solid var(--rule-soft);
    vertical-align: top; word-wrap: break-word; overflow-wrap: break-word;
  }
  table.data tbody tr:nth-child(even) td { background: #fbfcfe; }
  table.data tfoot td {
    border-top: 1.5px solid var(--rule); border-bottom: 0;
    padding-top: 7px; font-size: 8pt; background: transparent;
  }
  /* --- Asset thumbnails ------------------------------------------------- */
  /* 38pt ≈ 13mm on the page. Small on purpose: enough to recognise a machine
     at a glance without turning the asset table into a photo album. */
  .photo-cell { padding: 4px 6px; }
  .thumb {
    width: 38px; height: 38px; object-fit: cover; display: block;
    border-radius: 3px; border: 0.5px solid var(--rule);
    background: var(--rule-soft);
  }
  .thumb-empty { border-style: dashed; }

  .num { text-align: right; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .nowrap { white-space: nowrap; }
  /* Asset tags wrap rather than running under the next column. They break at
     their own hyphens, so WRK-NUT-001 stacks as WRK- / NUT-001 instead of
     forcing a column wide enough for the whole thing on one line. */
  .tag-cell { white-space: normal; overflow-wrap: break-word; }
  .mono {
    font-family: 'Consolas', 'SF Mono', 'Courier New', monospace;
    font-size: 7.5pt; font-weight: 600;
  }

  /* --- Pills ------------------------------------------------------------ */
  .pill {
    display: inline-block; font-size: 6.8pt; font-weight: 700;
    letter-spacing: .03em; padding: 2px 6px; border-radius: 9px; white-space: nowrap;
  }
  .pill-ok { background: var(--ok-bg); color: var(--ok); }
  .pill-idle { background: var(--idle-bg); color: var(--idle); }
  .pill-warn { background: var(--warn-bg); color: var(--warn); }
  .pill-bad { background: var(--bad-bg); color: var(--bad); }
  .pill-neutral { background: var(--neutral-bg); color: var(--neutral); }

  /* --- Links ------------------------------------------------------------ */
  .video-link {
    color: #1c5fd6; text-decoration: none; font-weight: 600; font-size: 7.5pt;
    border-bottom: 0.5px solid #a8c4f0;
  }

  /* --- End note --------------------------------------------------------- */
  .end-note {
    margin-top: 30px; padding-top: 10px; border-top: 1px solid var(--rule);
    text-align: center;
  }
  .end-note p { margin: 0; font-size: 7.5pt; color: var(--ink-muted); }

  /* --- Blocks added on the canvas --------------------------------------- */
  .added { break-inside: avoid; }
  .added-heading {
    font-size: 13pt; font-weight: 650; letter-spacing: -.01em;
    margin: 18px 0 6px; color: var(--accent);
  }
  .added-heading.sz-s { font-size: 10.5pt; }
  .added-heading.sz-l { font-size: 16pt; }
  .added-text { margin: 8px 0; font-size: 9pt; color: var(--ink-soft); line-height: 1.5; }
  .added-text.sz-s { font-size: 8pt; }
  .added-text.sz-l { font-size: 11pt; color: var(--ink); }
  .al-center { text-align: center; }
  .al-right { text-align: right; }
  .added-divider { border-top: 1px solid var(--rule); margin: 14px 0; height: 0; }
  /* Carries the break and nothing else; the sheet draws the rule in preview. */
  .added-break { height: 0; }
`;
