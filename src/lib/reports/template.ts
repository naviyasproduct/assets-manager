import 'server-only';
import type { AssetStatus } from '@prisma/client';
import type {
  ReportData,
  ReportDepartmentSection,
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

function kpi(label: string, value: string, note?: string): string {
  return `
    <div class="kpi">
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
// Tables
// ---------------------------------------------------------------------------

function assetTable(assets: ReportAssetRow[]): string {
  if (assets.length === 0) {
    return `<p class="empty">No assets recorded for this department.</p>`;
  }

  const rows = assets
    .map(
      (asset) => `
      <tr>
        <td class="photo-cell">${photoCell(asset.photoDataUri)}</td>
        <td class="mono nowrap">${esc(asset.assetTag)}</td>
        <td>
          <span class="strong">${esc(asset.name)}</span>
          ${asset.notes ? `<div class="sub">${esc(truncate(asset.notes, 90))}</div>` : ''}
        </td>
        <td>${esc(asset.category)}</td>
        <td>${orDash(asset.location)}</td>
        <td class="nowrap">${statusPill(asset.status)}</td>
        <td class="num nowrap">${esc(formatDate(asset.purchaseDate))}</td>
        <td class="num nowrap">${asset.purchaseCost === null ? dash : esc(formatMoney(asset.purchaseCost))}</td>
        <td class="num">${asset.fixCount > 0 ? asset.fixCount : dash}</td>
      </tr>`,
    )
    .join('');

  return `
    <table class="data">
      <colgroup>
        <!-- Status is the widest non-text column on purpose: "Needs replacement"
             is a nowrap pill, and anything narrower makes it overlap the next
             column at A4 width. -->
        <col style="width:7%"><col style="width:7%"><col style="width:20%">
        <col style="width:11%"><col style="width:10%"><col style="width:17%">
        <col style="width:9%"><col style="width:11%"><col style="width:5%">
      </colgroup>
      <thead>
        <tr>
          <th></th><th>Tag</th><th>Asset</th><th>Category</th><th>Location</th>
          <th>Status</th><th class="num">Purchased</th>
          <th class="num">Cost</th><th class="num">Fixes</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function purchaseTable(purchases: ReportPurchaseRow[]): string {
  if (purchases.length === 0) {
    return `<p class="empty">No outstanding purchase needs flagged.</p>`;
  }

  const rows = purchases
    .map((request) => {
      const replaces = request.replacesAssetTag
        ? `<div class="sub">Replaces ${esc(request.replacesAssetTag)} · ${esc(truncate(request.replacesAssetName ?? '', 40))}</div>`
        : '';

      return `
      <tr>
        <td>
          <span class="strong">${esc(request.title)}</span>
          ${replaces}
          <div class="sub">${esc(truncate(request.justification, 180))}</div>
        </td>
        <td>${esc(request.category)}</td>
        <td class="nowrap">${esc(PURCHASE_KIND_LABELS[request.kind])}</td>
        <td class="num">${request.quantity}</td>
        <td class="num nowrap">${request.estimatedCost === null ? dash : esc(formatMoney(request.estimatedCost))}</td>
        <td class="num nowrap strong">${request.lineTotal === null ? dash : esc(formatMoney(request.lineTotal))}</td>
        <td class="nowrap">${priorityPill(request.priority)}</td>
        <td class="nowrap">${
          request.status === 'APPROVED'
            ? '<span class="pill pill-ok">Approved</span>'
            : // Kept short deliberately: the pill is nowrap, and a longer label
              // overflows the column at A4 width. The header says "Status".
              '<span class="pill pill-neutral">Pending</span>'
        }</td>
      </tr>`;
    })
    .join('');

  const knownTotal = purchases.reduce((sum, p) => sum + (p.lineTotal ?? 0), 0);
  const unknownCount = purchases.filter((p) => p.lineTotal === null).length;

  return `
    <table class="data">
      <colgroup>
        <col style="width:33%"><col style="width:11%"><col style="width:10%">
        <col style="width:5%"><col style="width:11%"><col style="width:11%">
        <col style="width:9%"><col style="width:10%">
      </colgroup>
      <thead>
        <tr>
          <th>Requested item</th><th>Category</th><th>Type</th>
          <th class="num">Qty</th><th class="num">Unit est.</th>
          <th class="num">Line total</th><th>Priority</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="5" class="num strong">Estimated total</td>
          <td class="num strong">${esc(formatMoney(knownTotal))}</td>
          <td colspan="2" class="sub">${
            unknownCount > 0
              ? esc(`${unknownCount} item(s) without an estimate`)
              : ''
          }</td>
        </tr>
      </tfoot>
    </table>`;
}

function fixList(fixes: ReportFixRow[], linksArePublic: boolean): string {
  if (fixes.length === 0) return '';

  const rows = fixes
    .map((fix) => {
      const url = fix.videoUrl ? escUrl(fix.videoUrl) : '';
      const link = url
        ? `<a class="video-link" href="${url}">Watch repair video</a>`
        : dash;

      return `
      <tr>
        <td class="mono nowrap">${esc(fix.assetTag)}</td>
        <td><span class="strong">${esc(fix.title)}</span>
            <div class="sub">${esc(fix.assetName)}</div></td>
        <td>${esc(fix.fixedByName)}</td>
        <td class="num nowrap">${esc(formatDate(fix.fixedAt))}</td>
        <td class="nowrap">${link}</td>
      </tr>`;
    })
    .join('');

  return `
    <div class="subsection">
      <h3>Repair history &amp; videos</h3>
      ${
        linksArePublic
          ? ''
          : `<p class="notice">These links currently resolve to the office network address, so they will only open from inside the office. Configure PUBLIC_VIDEO_BASE_URL once the Cloudflare Tunnel is live to make them work off-site.</p>`
      }
      <table class="data">
        <colgroup>
          <col style="width:10%"><col style="width:40%"><col style="width:18%">
          <col style="width:14%"><col style="width:18%">
        </colgroup>
        <thead>
          <tr><th>Tag</th><th>Repair</th><th>Fixed by</th>
              <th class="num">Date</th><th>Video</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Page sections
// ---------------------------------------------------------------------------

function masthead(data: ReportData): string {
  const { meta } = data;

  const logo = meta.logoDataUri
    ? `<img class="logo" src="${meta.logoDataUri}" alt="">`
    : `<div class="logo-fallback">${esc(meta.companyName.slice(0, 2).toUpperCase())}</div>`;

  return `
    <header class="masthead">
      <div class="masthead-left">
        ${logo}
        <div class="masthead-id">
          <div class="company">${esc(meta.companyName)}</div>
          <div class="tagline">${esc(meta.tagline)}</div>
        </div>
      </div>
      <div class="masthead-right">
        <div class="doc-type">Internal report</div>
        <div class="doc-date">${esc(formatDate(meta.generatedAt))}</div>
      </div>
    </header>`;
}

function titleBlock(data: ReportData): string {
  const { meta, totals } = data;

  const filterNote =
    meta.options.statuses && meta.options.statuses.length > 0
      ? meta.options.statuses.map((s) => ASSET_STATUS_LABELS[s]).join(', ')
      : 'All statuses';

  return `
    <section class="title-block">
      <h1>${esc(meta.title)}</h1>
      <div class="scope">${esc(meta.scopeLabel)}</div>
      <dl class="meta-grid">
        <div><dt>Generated</dt><dd>${esc(formatDateTime(meta.generatedAt))}</dd></div>
        <div><dt>Prepared by</dt><dd>${esc(meta.generatedByName)} · ${esc(meta.generatedByRole)}</dd></div>
        <div><dt>Coverage</dt><dd>${totals.departmentCount} department${totals.departmentCount === 1 ? '' : 's'} · ${totals.assetCount} asset${totals.assetCount === 1 ? '' : 's'}</dd></div>
        <div><dt>Asset filter</dt><dd>${esc(filterNote)}</dd></div>
      </dl>
    </section>`;
}

function executiveSummary(data: ReportData): string {
  const { totals } = data;
  const needsAttention = totals.statusCounts.BROKEN + totals.statusCounts.NEEDS_REPLACEMENT;

  return `
    <section class="section keep-together">
      <h2>Executive summary</h2>

      <div class="kpi-row">
        ${kpi('Assets tracked', String(totals.assetCount), `across ${totals.departmentCount} department${totals.departmentCount === 1 ? '' : 's'}`)}
        ${kpi('Need attention', String(needsAttention), 'broken or due for replacement')}
        ${kpi('Awaiting decision', String(totals.pendingPurchaseCount), 'purchase requests')}
        ${kpi('Estimated spend', formatMoney(totals.pendingPurchaseEstimate), 'if all pending approved')}
      </div>

      <div class="chart-block">
        <div class="chart-title">Condition of tracked assets</div>
        ${statusBar(totals.statusCounts, totals.assetCount)}
      </div>

      <div class="value-note">
        Recorded purchase value of tracked assets:
        <strong>${esc(formatMoney(totals.knownValue))}</strong>${
          totals.assetsWithUnknownCost > 0
            ? ` <span class="muted">(${totals.assetsWithUnknownCost} asset${totals.assetsWithUnknownCost === 1 ? '' : 's'} with no recorded cost are excluded)</span>`
            : ''
        }
      </div>
    </section>`;
}

/** Company-wide only: the single list the CEO is most likely to act from. */
function attentionSection(data: ReportData): string {
  if (!data.meta.isCompanyWide || data.attention.length === 0) return '';

  const shown = data.attention.slice(0, 25);

  const rows = shown
    .map(
      (asset) => `
      <tr>
        <td class="photo-cell">${photoCell(asset.photoDataUri)}</td>
        <td class="mono nowrap">${esc(asset.assetTag)}</td>
        <td><span class="strong">${esc(asset.name)}</span>
            ${asset.notes ? `<div class="sub">${esc(truncate(asset.notes, 80))}</div>` : ''}</td>
        <td>${esc(asset.departmentName)}</td>
        <td>${esc(asset.category)}</td>
        <td class="nowrap">${statusPill(asset.status)}</td>
        <td class="num nowrap">${esc(formatDate(asset.purchaseDate))}</td>
      </tr>`,
    )
    .join('');

  return `
    <section class="section">
      <h2>Equipment requiring a decision</h2>
      <p class="lede">Assets currently broken or flagged for replacement, most severe first.</p>
      <table class="data">
        <colgroup>
          <col style="width:7%"><col style="width:8%"><col style="width:25%">
          <col style="width:14%"><col style="width:13%"><col style="width:19%">
          <col style="width:14%">
        </colgroup>
        <thead>
          <tr><th></th><th>Tag</th><th>Asset</th><th>Department</th>
              <th>Category</th><th>Status</th><th class="num">Purchased</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${
        data.attention.length > shown.length
          ? `<p class="sub">Showing the first ${shown.length} of ${data.attention.length}. The full list appears in the department sections that follow.</p>`
          : ''
      }
    </section>`;
}

function departmentSection(
  section: ReportDepartmentSection,
  data: ReportData,
  index: number,
): string {
  const { meta } = data;
  const needsAttention = section.statusCounts.BROKEN + section.statusCounts.NEEDS_REPLACEMENT;

  return `
    <section class="section department${index > 0 || meta.isCompanyWide ? ' page-break' : ''}">
      <div class="dept-header keep-together">
        <div class="dept-title">
          <h2>${esc(section.name)}</h2>
          <span class="code-chip">${esc(section.code)}</span>
        </div>
        ${section.description ? `<p class="lede">${esc(section.description)}</p>` : ''}
        ${section.location ? `<p class="sub">Location: ${esc(section.location)}</p>` : ''}

        <div class="dept-stats">
          <div class="dept-stat"><span class="n">${section.assetCount}</span><span class="l">Assets</span></div>
          <div class="dept-stat"><span class="n">${needsAttention}</span><span class="l">Need attention</span></div>
          <div class="dept-stat"><span class="n">${section.pendingPurchaseCount}</span><span class="l">Requests pending</span></div>
          <div class="dept-stat"><span class="n">${esc(formatMoney(section.pendingPurchaseEstimate))}</span><span class="l">Estimated spend</span></div>
        </div>

        <div class="chart-block compact">
          ${statusBar(section.statusCounts, section.assetCount)}
        </div>
      </div>

      ${
        meta.options.includeAssets
          ? `<div class="subsection">
               <h3>Assets</h3>
               ${assetTable(section.assets)}
             </div>`
          : ''
      }

      ${
        meta.options.includePurchases
          ? `<div class="subsection">
               <h3>Flagged purchase needs</h3>
               ${purchaseTable(section.purchases)}
             </div>`
          : ''
      }

      ${meta.options.includeFixes ? fixList(section.fixes, meta.videoLinksArePublic) : ''}
    </section>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function renderReportHtml(data: ReportData): string {
  const body = `
    ${masthead(data)}
    ${titleBlock(data)}
    ${executiveSummary(data)}
    ${attentionSection(data)}
    ${data.departments.map((section, i) => departmentSection(section, data, i)).join('')}
    <section class="end-note">
      <p>End of report · ${esc(data.meta.companyName)} · Generated ${esc(formatDateTime(data.meta.generatedAt))}</p>
    </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(data.meta.title)} - ${esc(data.meta.scopeLabel)}</title>
<style>${STYLES}</style>
</head>
<body>${body}</body>
</html>`;
}

/** Running header/footer, rendered by Puppeteer into the page margins. */
export function renderHeaderTemplate(data: ReportData): string {
  return `
    <div style="width:100%;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:7.5pt;color:#8a94a6;padding:0 14mm;">
      <div style="display:flex;justify-content:space-between;border-bottom:0.5px solid #dfe4ec;padding-bottom:3px;">
        <span>${esc(data.meta.companyName)} · ${esc(data.meta.title)}</span>
        <span>${esc(data.meta.scopeLabel)}</span>
      </div>
    </div>`;
}

export function renderFooterTemplate(data: ReportData): string {
  return `
    <div style="width:100%;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:7.5pt;color:#8a94a6;padding:0 14mm;">
      <div style="display:flex;justify-content:space-between;border-top:0.5px solid #dfe4ec;padding-top:4px;">
        <span>Confidential · internal use only</span>
        <span>Generated ${esc(formatDate(data.meta.generatedAt))}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    </div>`;
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
  .masthead-left { display: flex; align-items: center; gap: 11px; }
  .logo { max-height: 42px; max-width: 150px; object-fit: contain; display: block; }
  .logo-fallback {
    width: 40px; height: 40px; border-radius: 6px; background: var(--accent);
    color: #fff; font-size: 15pt; font-weight: 700; letter-spacing: .02em;
    display: flex; align-items: center; justify-content: center;
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
  .dept-title { display: flex; align-items: center; gap: 9px; }
  .dept-title h2 { border: 0; padding: 0; margin: 0; flex: 1; }
  .code-chip {
    font-size: 7.5pt; font-weight: 700; letter-spacing: .06em;
    background: var(--accent); color: #fff; padding: 2px 7px; border-radius: 3px;
  }
  .department .dept-header { border-bottom: 1px solid var(--rule); padding-bottom: 12px; margin-bottom: 4px; }
  .dept-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
  .dept-stat {
    display: flex; flex-direction: column; padding: 8px 10px;
    background: var(--panel); border-radius: 5px;
  }
  .dept-stat .n {
    font-size: 12pt; font-weight: 650; line-height: 1.1;
    font-variant-numeric: tabular-nums; color: var(--accent);
  }
  .dept-stat .l {
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
`;
