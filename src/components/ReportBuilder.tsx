'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetStatus, PurchasePriority, PurchaseStatus } from '@prisma/client';
import { api, downloadReport } from '@/lib/client';
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUS_ORDER,
  PURCHASE_PRIORITY_LABELS,
  PURCHASE_STATUS_LABELS,
} from '@/lib/format';
import { Field, Alert, Modal, ConfirmDialog } from '@/components/ui';
import { ASSET_SELECTION_KEY, takeDraft } from '@/lib/form-draft';
import type {
  DepartmentOption,
  AssetCategoryOption,
  LocationOption,
} from '@/components/AssetManager';
import {
  COLUMN_SETS,
  USABLE_WIDTH_LANDSCAPE_PX,
  USABLE_WIDTH_PX,
  solveColumnWidths,
  usableWidthPx,
  type ColumnMeta,
  type ColumnSetName,
} from '@/lib/reports/columns';
import {
  BLOCK_ID_PREFIX,
  BLOCK_TYPE_LABELS,
  BUILTIN_BLOCKS,
  GROUP_BY_LABELS,
  NO_LOCATION,
  SECTION_META,
  blockLabel,
  defaultBlock,
  defaultReportConfig,
  normalizeReportConfig,
  orderGroups,
  perGroupSections,
  topLevelFlow,
  type NormalizedBlock,
  type NormalizedColumn,
  type NormalizedReportConfig,
  type NormalizedSection,
  type ReportBlockType,
  type ReportGroupBy,
  type ReportSectionKey,
} from '@/lib/reports/config';

/**
 * The report builder.
 *
 * Everything on this screen edits one object - the setup in `config` - and the
 * preview on the right is that object rendered by the same template the PDF is
 * made from. There is no second description of what a report looks like, which
 * is what stops the preview and the printed document drifting apart.
 *
 * The rows people tick off are kept apart from the setup on purpose: they name
 * specific assets, and a saved report has to still make sense next year when
 * those assets have been replaced.
 */

export type SavedReport = {
  id: string;
  name: string;
  description: string | null;
  /** A stored setup. Shape is not trusted - normalizeReportConfig makes it safe. */
  config: unknown;
  createdById: string | null;
  authorName: string | null;
  updatedAt: string;
};

type Candidate = { id: string; label: string; sub: string; group: string };
type AssetCandidate = Candidate & { status: AssetStatus };

type PreviewPayload = {
  html: string;
  candidates: {
    assets: AssetCandidate[];
    purchases: Candidate[];
    fixes: Candidate[];
  };
  totals: {
    assetCount: number;
    purchaseCount: number;
    fixCount: number;
    groupCount: number;
    pendingPurchaseCount: number;
  };
  warnings: string[];
  groups: Array<{ key: string; label: string; assetCount: number }>;
};

const PURCHASE_STATUS_ORDER: PurchaseStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const PURCHASE_PRIORITY_ORDER: PurchasePriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const GROUP_BY_ORDER: ReportGroupBy[] = ['DEPARTMENT', 'LOCATION', 'CATEGORY', 'STATUS', 'NONE'];

/** What can be taken off the page with the ✕ and put back afterwards. */
const HIDEABLE_PREFIXES = ['group:', 'SUMMARY:', 'TITLE:', 'MASTHEAD:', 'ungrouped:'];

/**
 * Names for the parts of a block, used by the list of things that have been
 * removed. The canvas carries a label of its own on screen; this is the same
 * thing said with enough context to be recognised out of place.
 */
const PART_LABELS: Record<string, string> = {
  'MASTHEAD:right': 'Letterhead · report type and date',
  'TITLE:scope': 'Title block · what it covers',
  'TITLE:meta': 'Title block · report details',
  'SUMMARY:kpi:tracked': 'Summary · assets tracked',
  'SUMMARY:kpi:attention': 'Summary · need attention',
  'SUMMARY:kpi:awaiting': 'Summary · awaiting decision',
  'SUMMARY:kpi:spend': 'Summary · estimated spend',
  'SUMMARY:chart': 'Summary · condition bar',
  'SUMMARY:value': 'Summary · recorded value line',
  'ungrouped:PURCHASES': 'Purchase requests listed once',
  'ungrouped:FIXES': 'Repair history listed once',
};

const BLOCK_ALIGNMENTS: Array<NormalizedBlock['align']> = ['LEFT', 'CENTER', 'RIGHT'];
const BLOCK_SIZES: Array<NormalizedBlock['size']> = ['S', 'M', 'L'];
const ALIGN_LABELS: Record<NormalizedBlock['align'], string> = {
  LEFT: 'Left',
  CENTER: 'Centre',
  RIGHT: 'Right',
};
const SIZE_LABELS: Record<NormalizedBlock['size'], string> = {
  S: 'Small',
  M: 'Normal',
  L: 'Large',
};
const ADDABLE: ReportBlockType[] = ['HEADING', 'TEXT', 'DIVIDER', 'SPACER', 'BREAK'];

export function ReportBuilder({
  isAdmin,
  fromSelection,
  currentUserId,
  departments,
  categories,
  locations,
  savedReports,
  initialDepartmentIds,
  videoLinksArePublic,
}: {
  isAdmin: boolean;
  /** Arrived from assets ticked on the Assets screen, not from the nav. */
  fromSelection: boolean;
  currentUserId: string;
  departments: DepartmentOption[];
  categories: AssetCategoryOption[];
  locations: LocationOption[];
  savedReports: SavedReport[];
  initialDepartmentIds: string[];
  videoLinksArePublic: boolean;
}) {
  const [config, setConfig] = useState<NormalizedReportConfig>(() => ({
    ...defaultReportConfig(),
    departmentIds: initialDepartmentIds,
    // Assets picked on the Assets screen are one list somebody chose, not a
    // department-by-department review, so the departments run on rather than
    // each taking a fresh page - three machines should not print as three
    // pages. It is the same checkbox as ever, just starting off.
    pageBreakPerGroup: !fromSelection,
  }));

  /**
   * Assets ticked on the Assets screen, if that is where this came from.
   *
   * Read once, during the first render, because `takeDraft` consumes what it
   * reads: doing it in an effect would run twice under React's development
   * double-invoke and the second pass would find nothing.
   *
   * Kept apart from the setup for the same reason the row picks are - it names
   * specific assets, and a saved report has to outlive them.
   */
  const [pickedAssetIds, setPickedAssetIds] = useState<string[]>(() => {
    if (!fromSelection) return [];
    const handed = takeDraft<{ assetIds?: string[] }>(ASSET_SELECTION_KEY);
    return handed?.assetIds ?? [];
  });

  const [excludedAssets, setExcludedAssets] = useState<Set<string>>(new Set());
  const [excludedPurchases, setExcludedPurchases] = useState<Set<string>>(new Set());
  const [excludedFixes, setExcludedFixes] = useState<Set<string>>(new Set());

  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewBusy, setPreviewBusy] = useState(true);
  const [previewError, setPreviewError] = useState('');

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfDone, setPdfDone] = useState(false);

  // Saved reports are held here rather than re-read from the server after each
  // write: the list is small, this screen owns it entirely, and a refresh would
  // race the optimistic update that has already put the new row on screen.
  const [reports, setReports] = useState<SavedReport[]>(savedReports);
  const [reportId, setReportId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const currentReport = reports.find((report) => report.id === reportId) ?? null;
  const mayEditCurrent =
    currentReport !== null && (isAdmin || currentReport.createdById === currentUserId);

  // --- The canvas -----------------------------------------------------------

  const frameRef = useRef<HTMLIFrameElement>(null);
  const [selection, setSelection] = useState<{ id: string; kind: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState(true);
  const [openTool, setOpenTool] = useState<string | null>(null);

  /** Where the reader had scrolled to, handed back after every re-render. */
  const scrollRef = useRef(0);

  // --- Editing the setup ----------------------------------------------------
  //
  // Every change goes through `commit`, which is also what makes undo possible:
  // one place that knows the setup is about to change and can keep the version
  // before it. `mergeKey` collapses a run of keystrokes into a single step, so
  // undo does not walk back through a title one letter at a time.

  const past = useRef<NormalizedReportConfig[]>([]);
  const future = useRef<NormalizedReportConfig[]>([]);
  const merge = useRef<{ key: string; at: number } | null>(null);
  // Held only to force a render: the undo and redo stacks live in refs, and
  // their buttons have to notice when those change.
  const [, bumpHistory] = useState(0);

  function commit(next: NormalizedReportConfig, mergeKey?: string) {
    if (next === config) return;

    const now = Date.now();
    const continues =
      mergeKey !== undefined && merge.current?.key === mergeKey && now - merge.current.at < 1200;

    if (!continues) past.current = [...past.current.slice(-49), config];
    merge.current = mergeKey === undefined ? null : { key: mergeKey, at: now };
    future.current = [];

    setConfig(next);
    setDirty(true);
    bumpHistory((tick) => tick + 1);
  }

  function patch(changes: Partial<NormalizedReportConfig>, mergeKey?: string) {
    commit({ ...config, ...changes }, mergeKey);
  }

  function toggleId(key: 'departmentIds' | 'locationIds' | 'categoryIds', id: string) {
    const list = config[key];
    patch({ [key]: list.includes(id) ? list.filter((v) => v !== id) : [...list, id] });
  }

  function setSection(
    key: ReportSectionKey,
    changes: Partial<NormalizedSection>,
    mergeKey?: string,
  ) {
    patch(
      {
        sections: config.sections.map((section) =>
          section.key === key ? { ...section, ...changes } : section,
        ),
      },
      mergeKey,
    );
  }

  /** Moves `id` so it sits before `before`, or last when `before` is null. */
  function moveInLayout(id: string, before: string | null) {
    if (!config.layout.includes(id)) return;
    if (before !== null && !config.layout.includes(before)) return;

    const next = config.layout.filter((value) => value !== id);
    const at = before === null ? next.length : next.indexOf(before);
    next.splice(at < 0 ? next.length : at, 0, id);
    patch({ layout: next });
  }

  /** The same move, from a list on screen that knows only its own indexes. */
  function moveWithinList(ids: string[], from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return;
    moveInLayout(ids[from], to > from ? (ids[to + 1] ?? null) : ids[to]);
  }

  function restore(snapshot: NormalizedReportConfig) {
    merge.current = null;
    setConfig(snapshot);
    setDirty(true);
    bumpHistory((tick) => tick + 1);
  }

  function undo() {
    const previous = past.current[past.current.length - 1];
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [config, ...future.current.slice(0, 49)];
    restore(previous);
  }

  function redo() {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current.slice(-49), config];
    restore(next);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      const node = event.target as HTMLElement | null;
      // Let the browser's own undo have the field the person is typing in.
      if (node && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // --- Live preview -------------------------------------------------------
  //
  // Debounced, and every response carries the sequence number of the request
  // that produced it: dragging a column edge fires a lot of these, and an older
  // one landing last would put the wrong document on screen.

  const sequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const mine = ++sequence.current;

    const timer = setTimeout(async () => {
      setPreviewBusy(true);

      const result = await api<PreviewPayload>('/api/reports/preview', {
        method: 'POST',
        signal: controller.signal,
        json: {
          config,
          includeAssetIds: pickedAssetIds,
          excludedAssetIds: [...excludedAssets],
          excludedPurchaseIds: [...excludedPurchases],
          excludedFixIds: [...excludedFixes],
          editable: editing,
        },
      });

      if (mine !== sequence.current) return;

      setPreviewBusy(false);
      if (result.ok) {
        setPreview(result.data);
        setPreviewError('');
      } else if (result.status !== 0) {
        setPreviewError(result.error);
      }
    }, 320);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [config, pickedAssetIds, excludedAssets, excludedPurchases, excludedFixes, editing]);

  // --- What the canvas asks for ---------------------------------------------
  //
  // Everything below arrives from a sandboxed iframe, so it is treated the way
  // a URL parameter would be: an id is only acted on once it has been found in
  // the setup or in the rows the server just sent back. The listener is
  // re-attached every render rather than memoised, so it always closes over the
  // setup as it is now.

  const groupKeys = useMemo(
    () => orderGroups(config, preview?.groups ?? []).map((group) => group.key),
    [config, preview],
  );

  const flowIds = useMemo(
    () =>
      topLevelFlow(config)
        .filter((item) => {
          if (config.hiddenBlocks.includes(item.id)) return false;
          if (item.kind === 'SECTION') return item.section.enabled;
          if (item.kind === 'BLOCK') return item.block.enabled;
          return true;
        })
        .map((item) => item.id),
    [config],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;

      const message = event.data as Record<string, unknown> | null;
      if (!message || message.rc !== 1 || typeof message.t !== 'string') return;

      const id = typeof message.id === 'string' ? message.id : null;

      switch (message.t) {
        case 'ready':
          // The document is rebuilt on every edit, so where they were reading
          // and what they had selected have to be handed straight back.
          frame.contentWindow?.postMessage(
            { rc: 2, t: 'restore', y: scrollRef.current, id: selection?.id ?? null },
            '*',
          );
          return;

        case 'scroll':
          if (typeof message.y === 'number') scrollRef.current = message.y;
          return;

        case 'select':
        case 'edit':
          setSelection(id ? { id, kind: String(message.kind ?? 'part') } : null);
          return;

        case 'remove':
          if (id) removeBlock(id);
          return;

        case 'move':
          if (!id) return;
          if (message.kind === 'group') {
            moveGroup(
              id.slice('group:'.length),
              typeof message.before === 'string'
                ? message.before.slice('group:'.length)
                : null,
            );
          } else {
            moveInLayout(id, typeof message.before === 'string' ? message.before : null);
          }
          return;

        case 'nudge': {
          if (!id || typeof message.delta !== 'number') return;
          const list = message.kind === 'group' ? groupKeys.map((key) => `group:${key}`) : flowIds;
          const from = list.indexOf(id);
          if (from < 0) return;
          const to = from + (message.delta < 0 ? -1 : 1);
          if (to < 0 || to >= list.length) return;

          if (message.kind === 'group') {
            const keys = groupKeys;
            moveGroup(keys[from], to > from ? (keys[to + 1] ?? null) : keys[to]);
          } else {
            moveWithinList(list, from, to);
          }
          return;
        }

        case 'dropcol':
          if (typeof message.table === 'string' && typeof message.col === 'string') {
            dropColumn(message.table, message.col);
          }
          return;

        case 'width':
          if (typeof message.table === 'string') {
            setWidths(message.table, message.keys, message.widths);
          }
          return;

        case 'droprow':
          if (id) dropRow(String(message.kind), id);
          return;

        case 'settext':
          if (id && typeof message.text === 'string') {
            setBlockText(id, String(message.field ?? 'text'), message.text);
          }
          return;

        // Forwarded from inside the canvas: once something in there has been
        // clicked the keyboard is in that document, and this page never sees
        // the shortcut.
        case 'key':
          if (message.key === 'z' && !message.shift) undo();
          else redo();
          return;

        default:
          return;
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  // --- Blocks ---------------------------------------------------------------

  function isSectionKey(id: string): id is ReportSectionKey {
    return id in SECTION_META;
  }

  /** Parts of a block that the ✕ hides rather than deletes. */
  function isHideable(id: string): boolean {
    return (
      id in BUILTIN_BLOCKS ||
      HIDEABLE_PREFIXES.some((prefix) => id.startsWith(prefix))
    );
  }

  function removeBlock(id: string) {
    // A section is switched off rather than hidden: that is the same state the
    // section list has always had, and it is what stops the data being queried.
    if (isSectionKey(id)) {
      setSection(id, { enabled: false });
      return;
    }
    if (id.startsWith(BLOCK_ID_PREFIX)) {
      patch({
        blocks: config.blocks.filter((block) => block.id !== id),
        layout: config.layout.filter((value) => value !== id),
      });
      setSelection(null);
      return;
    }
    if (!isHideable(id) || config.hiddenBlocks.includes(id)) return;
    patch({ hiddenBlocks: [...config.hiddenBlocks, id] });
  }

  function bringBack(id: string) {
    if (isSectionKey(id)) {
      setSection(id, { enabled: true });
      return;
    }
    patch({ hiddenBlocks: config.hiddenBlocks.filter((value) => value !== id) });
  }

  function addBlock(type: ReportBlockType) {
    const block = defaultBlock(type);
    const layout = [...config.layout];

    // Dropped straight after whatever is selected, which is where someone
    // pointing at the page expects it to land. With nothing selected it goes
    // above the closing line - the end of the document proper.
    const at =
      selection && layout.includes(selection.id)
        ? layout.indexOf(selection.id) + 1
        : layout.includes('ENDNOTE')
          ? layout.indexOf('ENDNOTE')
          : layout.length;

    layout.splice(at, 0, block.id);
    commit({ ...config, blocks: [...config.blocks, block], layout });
    setSelection({ id: block.id, kind: 'flow' });
    setOpenTool(null);
  }

  function setBlock(id: string, changes: Partial<NormalizedBlock>, mergeKey?: string) {
    patch(
      { blocks: config.blocks.map((block) => (block.id === id ? { ...block, ...changes } : block)) },
      mergeKey,
    );
  }

  function setBlockText(id: string, field: string, raw: string) {
    const text = raw.replace(/\r/g, '').trim();

    if (id === 'TITLE') {
      if (field === 'title') patch({ title: text.slice(0, 120) || null }, 'title');
      if (field === 'intro') patch({ intro: text.slice(0, 600) || null }, 'intro');
      return;
    }
    if (config.blocks.some((block) => block.id === id)) {
      setBlock(id, { text: text.slice(0, 2000) || null }, `text:${id}`);
    }
  }

  function moveGroup(key: string, before: string | null) {
    if (!groupKeys.includes(key)) return;
    const next = groupKeys.filter((value) => value !== key);
    const at = before === null ? next.length : next.indexOf(before);
    next.splice(at < 0 ? next.length : at, 0, key);
    patch({ groupOrder: next });
  }

  function dropColumn(table: string, column: string) {
    if (!isSectionKey(table)) return;
    const section = config.sections.find((item) => item.key === table);
    // The last column cannot go: a table with no columns cannot be rendered,
    // and normalising one would only put the defaults back.
    if (!section || section.columns.length <= 1) return;
    setSection(table, { columns: section.columns.filter((item) => item.key !== column) });
  }

  function setWidths(table: string, keys: unknown, widths: unknown) {
    if (!isSectionKey(table)) return;
    if (!Array.isArray(keys) || !Array.isArray(widths) || keys.length !== widths.length) return;

    const section = config.sections.find((item) => item.key === table);
    if (!section) return;

    const wanted = new Map<string, number>();
    keys.forEach((key, index) => {
      const width = widths[index];
      if (typeof key === 'string' && typeof width === 'number' && Number.isFinite(width)) {
        wanted.set(key, Math.min(90, Math.max(1, Math.round(width))));
      }
    });

    setSection(table, {
      columns: section.columns.map((column) =>
        wanted.has(column.key) ? { ...column, width: wanted.get(column.key) } : column,
      ),
    });
  }

  function dropRow(kind: string, id: string) {
    if (kind === 'asset' && preview?.candidates.assets.some((row) => row.id === id)) {
      setExcludedAssets(new Set([...excludedAssets, id]));
    } else if (kind === 'purchase' && preview?.candidates.purchases.some((row) => row.id === id)) {
      setExcludedPurchases(new Set([...excludedPurchases, id]));
    } else if (kind === 'fix' && preview?.candidates.fixes.some((row) => row.id === id)) {
      setExcludedFixes(new Set([...excludedFixes, id]));
    }
  }

  // --- Generating -----------------------------------------------------------

  async function generate() {
    setPdfBusy(true);
    setPdfError('');
    setPdfDone(false);

    const result = await downloadReport({
      config,
      includeAssetIds: pickedAssetIds,
      excludedAssetIds: [...excludedAssets],
      excludedPurchaseIds: [...excludedPurchases],
      excludedFixIds: [...excludedFixes],
    });

    setPdfBusy(false);
    if (!result.ok) {
      setPdfError(result.error);
      return;
    }
    setPdfDone(true);
    setTimeout(() => setPdfDone(false), 5000);
  }

  // --- Saved reports --------------------------------------------------------

  function applyReport(report: SavedReport | null) {
    if (!report) {
      setConfig({ ...defaultReportConfig(), departmentIds: initialDepartmentIds });
      setReportId(null);
      setDirty(false);
      setNotice('');
      return;
    }

    const { config: stored, warnings } = normalizeReportConfig(
      report.config as Partial<NormalizedReportConfig>,
    );

    // A shared setup may name departments this person cannot see. Narrowing it
    // here rather than at the server is what lets a department head open the
    // company's monthly report and get their own equipment: the API still
    // refuses a department outside their scope, and now never receives one.
    const visible = new Set(departments.map((department) => department.id));
    const departmentIds = stored.departmentIds.filter((id) => visible.has(id));
    const narrowed = departmentIds.length !== stored.departmentIds.length;

    setConfig({ ...stored, departmentIds });
    setReportId(report.id);
    setDirty(false);
    setNotice(
      [
        ...warnings,
        narrowed
          ? 'This report covers departments you do not have access to. It has been narrowed to yours.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  async function saveOver() {
    if (!currentReport) return;
    setSaveBusy(true);
    setSaveError('');

    const result = await api<{ preset: SavedReport }>(`/api/report-presets/${currentReport.id}`, {
      method: 'PATCH',
      json: { config },
    });

    setSaveBusy(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }

    setReports((current) =>
      current.map((report) =>
        report.id === currentReport.id ? { ...report, config, updatedAt: new Date().toISOString() } : report,
      ),
    );
    setDirty(false);
    setNotice(`Saved to "${currentReport.name}".`);
  }

  async function saveAs(name: string, description: string) {
    setSaveBusy(true);
    setSaveError('');

    const result = await api<{ preset: SavedReport }>('/api/report-presets', {
      method: 'POST',
      json: { name, description, config },
    });

    setSaveBusy(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }

    const saved: SavedReport = {
      id: result.data.preset.id,
      name,
      description: description || null,
      config,
      createdById: currentUserId,
      authorName: null,
      updatedAt: new Date().toISOString(),
    };

    setReports((current) => [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
    setReportId(saved.id);
    setDirty(false);
    setSaveOpen(false);
    setNotice(`Saved as "${name}". Everyone can now generate it.`);
  }

  async function remove() {
    if (!currentReport) return;
    setSaveBusy(true);
    setSaveError('');

    const result = await api(`/api/report-presets/${currentReport.id}`, { method: 'DELETE' });

    setSaveBusy(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }

    setReports((current) => current.filter((report) => report.id !== currentReport.id));
    setDeleting(false);
    applyReport(null);
    setNotice(`Deleted "${currentReport.name}".`);
  }

  // --- Row exclusions -------------------------------------------------------

  function toggleExcluded(
    set: Set<string>,
    apply: (next: Set<string>) => void,
    id: string,
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  const categoriesInScope = useMemo(() => {
    if (config.departmentIds.length === 0) return categories;
    const wanted = new Set(config.departmentIds);
    return categories.filter((category) => wanted.has(category.departmentId));
  }, [categories, config.departmentIds]);

  const departmentName = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  );

  const groupLabels = useMemo(
    () => new Map((preview?.groups ?? []).map((group) => [group.key, group.label])),
    [preview],
  );

  /** Which section's columns a selected block edits, if any. */
  function sectionKeyFor(id: string): ReportSectionKey | null {
    const last = id.split(':').pop() ?? '';
    return last in SECTION_META ? (last as ReportSectionKey) : null;
  }

  /** What to call a block away from the page, where it has no context. */
  function describe(id: string): string {
    if (id in BUILTIN_BLOCKS) return BUILTIN_BLOCKS[id].label;
    if (id in SECTION_META) return SECTION_META[id as ReportSectionKey].label;
    if (PART_LABELS[id]) return PART_LABELS[id];

    if (id.startsWith('group:')) {
      const [, key, part] = id.split(':');
      const label = groupLabels.get(key) ?? key;
      if (!part) return label;
      if (part in SECTION_META) return `${label} · ${SECTION_META[part as ReportSectionKey].label}`;
      return `${label} · ${part === 'header' ? 'heading' : part === 'stats' ? 'figures' : 'condition bar'}`;
    }

    const block = config.blocks.find((item) => item.id === id);
    return block ? blockLabel(block) : id;
  }

  const layers = useMemo(
    () =>
      topLevelFlow(config).map((item) => ({
        id: item.id,
        label: item.label,
        sub:
          item.kind === 'BUILTIN'
            ? BUILTIN_BLOCKS[item.id].description
            : item.kind === 'SECTION'
              ? SECTION_META[item.id].description
              : BLOCK_TYPE_LABELS[item.block.type],
        on:
          !config.hiddenBlocks.includes(item.id) &&
          (item.kind === 'SECTION'
            ? item.section.enabled
            : item.kind === 'BLOCK'
              ? item.block.enabled
              : true),
        columns:
          item.kind === 'SECTION' && SECTION_META[item.id].columnSet
            ? item.section.columns.length
            : null,
      })),
    [config],
  );

  const groupLayers = useMemo(
    () =>
      config.layout
        .filter((id) => id in SECTION_META && SECTION_META[id as ReportSectionKey].perGroup)
        .map((id) => {
          const key = id as ReportSectionKey;
          const section = config.sections.find((item) => item.key === key);
          return {
            id,
            label: SECTION_META[key].label,
            sub: SECTION_META[key].description,
            on: (section?.enabled ?? false) && !config.hiddenBlocks.includes(id),
            columns: section?.columns.length ?? null,
          };
        }),
    [config],
  );

  /** Everything taken off the page, so it can be put back. */
  const removedItems = useMemo(() => {
    const off = config.sections
      .filter((section) => !section.enabled)
      .map((section) => section.key as string);
    return [...off, ...config.hiddenBlocks];
  }, [config]);

  function toggleLayer(id: string, on: boolean) {
    if (config.blocks.some((block) => block.id === id)) {
      setBlock(id, { enabled: on });
      return;
    }
    if (on) bringBack(id);
    else removeBlock(id);
  }

  function pick(id: string, kind: string) {
    setSelection({ id, kind });
    setOpenTool(null);
  }

  const selectedBlock = selection
    ? (config.blocks.find((block) => block.id === selection.id) ?? null)
    : null;
  const selectedSection = selection ? sectionKeyFor(selection.id) : null;

  /** One tick for a part of a block that the ✕ hides rather than deletes. */
  const partRow = (id: string, label: string) => (
    <label className="checkbox" key={id}>
      <input
        type="checkbox"
        checked={!config.hiddenBlocks.includes(id)}
        onChange={(event) => (event.target.checked ? bringBack(id) : removeBlock(id))}
      />
      {label}
    </label>
  );

  const selectedColumnSet =
    selectedSection && SECTION_META[selectedSection].columnSet
      ? COLUMN_SETS[SECTION_META[selectedSection].columnSet as ColumnSetName]
      : null;

  const selectedColumns = selectedSection
    ? (config.sections.find((section) => section.key === selectedSection)?.columns ?? [])
    : [];

  /** The group a block id belongs to: group:<key> or group:<key>:<part>. */
  function groupKeyOf(id: string): string {
    return id.split(':')[1] ?? '';
  }

  // One tool panel open at a time, closed by clicking anywhere else or Escape -
  // the panels sit over the page being edited, so they must not linger.
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openTool) return;

    function onDown(event: PointerEvent) {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setOpenTool(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenTool(null);
    }

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openTool]);

  return (
    <div className="studio">
      {/* --- The tool bar ---------------------------------------------- */}
      <div className="studio-bar" ref={barRef}>
        <div className="tool-group">
          <Tool id="file" label="Report" open={openTool} onOpen={setOpenTool}>
            {saveError ? <Alert>{saveError}</Alert> : null}
            <Field
              label="Start from"
              htmlFor="saved-report"
              hint={
                currentReport?.description ||
                (currentReport
                  ? `Saved by ${currentReport.authorName ?? 'someone since removed'}`
                  : 'The default is the company report as it has always been laid out.')
              }
            >
              <select
                id="saved-report"
                value={reportId ?? ''}
                onChange={(event) =>
                  applyReport(reports.find((report) => report.id === event.target.value) ?? null)
                }
              >
                <option value="">Default report</option>
                {reports.map((report) => (
                  <option key={report.id} value={report.id}>
                    {report.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="row-actions" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={saveOver}
                disabled={!mayEditCurrent || !dirty || saveBusy}
                title={
                  currentReport && !mayEditCurrent
                    ? 'Only the person who saved this, or an admin, can change it'
                    : undefined
                }
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSaveError('');
                  setSaveOpen(true);
                }}
                disabled={saveBusy}
              >
                Save as…
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => applyReport(null)}
                disabled={saveBusy}
              >
                Reset
              </button>
              {currentReport ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setDeleting(true)}
                  disabled={!mayEditCurrent || saveBusy}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </Tool>

          <button
            type="button"
            className="tool-icon"
            onClick={undo}
            disabled={past.current.length === 0}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            ↺
          </button>
          <button
            type="button"
            className="tool-icon"
            onClick={redo}
            disabled={future.current.length === 0}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            ↻
          </button>
        </div>

        <div className="tool-sep" />

        <div className="tool-group">
          <Tool id="add" label="Add" open={openTool} onOpen={setOpenTool}>
            <div className="section-label">Put on the page</div>
            <div className="chip-row">
              {ADDABLE.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="chip chip-add"
                  onClick={() => addBlock(type)}
                >
                  + {BLOCK_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
            <p className="hint">
              Lands just under whatever is selected on the page. Double-click a heading or a note to
              type straight into it.
            </p>

            {removedItems.length > 0 ? (
              <>
                <div className="divider" />
                <div className="section-label">Taken off ({removedItems.length})</div>
                <ul className="removed-list">
                  {removedItems.map((id) => (
                    <li key={id}>
                      <span>{describe(id)}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => bringBack(id)}
                      >
                        Put back
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Tool>

          <Tool id="layers" label="Blocks" open={openTool} onOpen={setOpenTool}>
            <div className="section-label">The page, top to bottom</div>
            <LayerList
              items={layers}
              selectedId={selection?.id ?? null}
              onMove={(from, to) =>
                moveWithinList(
                  layers.map((layer) => layer.id),
                  from,
                  to,
                )
              }
              onToggle={toggleLayer}
              onSelect={(id) => pick(id, 'flow')}
            />

            <div className="divider" />
            <div className="section-label">Inside every group</div>
            <LayerList
              items={groupLayers}
              selectedId={selection?.id ?? null}
              onMove={(from, to) =>
                moveWithinList(
                  groupLayers.map((layer) => layer.id),
                  from,
                  to,
                )
              }
              onToggle={toggleLayer}
              onSelect={(id) => pick(id, 'part')}
            />
            <p className="hint">
              These repeat under each {GROUP_BY_LABELS[config.groupBy].toLowerCase()}. Drag them to
              change the order they come in within a group.
            </p>
          </Tool>

          <Tool id="data" label="Data" open={openTool} onOpen={setOpenTool} wide>
            <PickerList
              label="Departments"
              noun="department"
              hint={
                isAdmin
                  ? 'None ticked covers every department.'
                  : 'You can report on your own department.'
              }
              options={departments.map((department) => ({
                id: department.id,
                label: department.name,
                sub: department.code === department.name ? '' : department.code,
              }))}
              selected={config.departmentIds}
              onToggle={(id) => toggleId('departmentIds', id)}
              onSet={(ids) => patch({ departmentIds: ids })}
            />

            <div className="divider" />

            <PickerList
              label="Locations"
              noun="location"
              hint="None ticked covers everywhere."
              options={[
                ...locations.map((location) => ({
                  id: location.id,
                  label: location.name,
                  sub: location.isActive ? '' : 'retired',
                })),
                { id: NO_LOCATION, label: 'No location set', sub: 'unplaced equipment' },
              ]}
              selected={config.locationIds}
              onToggle={(id) => toggleId('locationIds', id)}
              onSet={(ids) => patch({ locationIds: ids })}
            />

            <div className="divider" />

            <PickerList
              label="Categories"
              noun="category"
              hint={
                config.departmentIds.length > 0
                  ? 'Only the categories of the departments above.'
                  : 'None ticked covers every category.'
              }
              options={categoriesInScope.map((category) => ({
                id: category.id,
                label: category.name,
                sub: departmentName.get(category.departmentId) ?? '',
              }))}
              selected={config.categoryIds}
              onToggle={(id) => toggleId('categoryIds', id)}
              onSet={(ids) => patch({ categoryIds: ids })}
            />

            <div className="divider" />

            <div className="section-label">Condition</div>
            <div className="chip-row">
              {ASSET_STATUS_ORDER.map((status) => (
                <Chip
                  key={status}
                  on={config.statuses.includes(status)}
                  onClick={() =>
                    patch({
                      statuses: config.statuses.includes(status)
                        ? config.statuses.filter((value) => value !== status)
                        : [...config.statuses, status],
                    })
                  }
                >
                  {ASSET_STATUS_LABELS[status]}
                </Chip>
              ))}
            </div>

            <Field
              label="Search"
              htmlFor="report-search"
              hint="Matches name, tag, serial and notes."
            >
              <input
                id="report-search"
                type="search"
                value={config.search ?? ''}
                placeholder="Anything in the equipment record"
                onChange={(event) => patch({ search: event.target.value || null }, 'search')}
              />
            </Field>

            <div className="divider" />

            <div className="section-label">Request status</div>
            <div className="chip-row">
              {PURCHASE_STATUS_ORDER.map((status) => (
                <Chip
                  key={status}
                  on={config.purchaseStatuses.includes(status)}
                  onClick={() =>
                    patch({
                      purchaseStatuses: config.purchaseStatuses.includes(status)
                        ? config.purchaseStatuses.filter((value) => value !== status)
                        : [...config.purchaseStatuses, status],
                    })
                  }
                >
                  {PURCHASE_STATUS_LABELS[status]}
                </Chip>
              ))}
            </div>

            <div className="section-label" style={{ marginTop: 14 }}>
              Priority
            </div>
            <div className="chip-row">
              {PURCHASE_PRIORITY_ORDER.map((priority) => (
                <Chip
                  key={priority}
                  on={config.purchasePriorities.includes(priority)}
                  onClick={() =>
                    patch({
                      purchasePriorities: config.purchasePriorities.includes(priority)
                        ? config.purchasePriorities.filter((value) => value !== priority)
                        : [...config.purchasePriorities, priority],
                    })
                  }
                >
                  {PURCHASE_PRIORITY_LABELS[priority]}
                </Chip>
              ))}
            </div>

            <div className="divider" />

            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.fixesRequireVideo}
                onChange={(event) => patch({ fixesRequireVideo: event.target.checked })}
              />
              Only repairs that have a video
            </label>
            {!videoLinksArePublic ? (
              <Alert kind="warn">
                No public video address is configured, so links in the PDF will only open from
                inside the office. Set <code>PUBLIC_VIDEO_BASE_URL</code> once the Cloudflare Tunnel
                is running.
              </Alert>
            ) : null}
          </Tool>

          <Tool id="grouping" label="Grouping" open={openTool} onOpen={setOpenTool}>
            <div className="section-label">Break the equipment up by</div>
            <div className="chip-row">
              {GROUP_BY_ORDER.map((groupBy) => (
                <Chip
                  key={groupBy}
                  on={config.groupBy === groupBy}
                  onClick={() => patch({ groupBy })}
                >
                  {GROUP_BY_LABELS[groupBy]}
                </Chip>
              ))}
            </div>

            {config.groupBy !== 'NONE' ? (
              <>
                <div className="divider" />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={config.pageBreakPerGroup}
                    onChange={(event) => patch({ pageBreakPerGroup: event.target.checked })}
                  />
                  Start each {GROUP_BY_LABELS[config.groupBy].toLowerCase()} on a new page
                </label>
                <p className="hint">
                  Off, the groups run on down the page - right for a report about a handful of
                  machines. A page each is right when a section is something you would hand out on
                  its own.
                </p>

                {groupKeys.length > 1 ? (
                  <>
                    <div className="section-label" style={{ marginTop: 12 }}>
                      Order on the page
                    </div>
                    <LayerList
                      items={groupKeys.map((key) => ({
                        id: `group:${key}`,
                        label: groupLabels.get(key) ?? key,
                        sub: '',
                        on: !config.hiddenBlocks.includes(`group:${key}`),
                        columns: null,
                      }))}
                      selectedId={selection?.id ?? null}
                      onMove={(from, to) =>
                        moveGroup(
                          groupKeys[from],
                          to > from ? (groupKeys[to + 1] ?? null) : groupKeys[to],
                        )
                      }
                      onToggle={toggleLayer}
                      onSelect={(id) => pick(id, 'group')}
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </Tool>

          <Tool id="rows" label="Rows" open={openTool} onOpen={setOpenTool} wide>
            <p className="hint" style={{ marginTop: 0 }}>
              Everything that matched. Untick anything that should not appear this time - or click
              the ✕ beside a row on the page. Row picks are for this run and are not kept in a saved
              report.
            </p>

            <RowPicker
              title="Assets"
              rows={preview?.candidates.assets ?? []}
              excluded={excludedAssets}
              onToggle={(id) => toggleExcluded(excludedAssets, setExcludedAssets, id)}
              onAll={() => setExcludedAssets(new Set())}
              onNone={() =>
                setExcludedAssets(new Set((preview?.candidates.assets ?? []).map((row) => row.id)))
              }
            />
            <RowPicker
              title="Purchase requests"
              rows={preview?.candidates.purchases ?? []}
              excluded={excludedPurchases}
              onToggle={(id) => toggleExcluded(excludedPurchases, setExcludedPurchases, id)}
              onAll={() => setExcludedPurchases(new Set())}
              onNone={() =>
                setExcludedPurchases(
                  new Set((preview?.candidates.purchases ?? []).map((row) => row.id)),
                )
              }
            />
            <RowPicker
              title="Repairs"
              rows={preview?.candidates.fixes ?? []}
              excluded={excludedFixes}
              onToggle={(id) => toggleExcluded(excludedFixes, setExcludedFixes, id)}
              onAll={() => setExcludedFixes(new Set())}
              onNone={() =>
                setExcludedFixes(new Set((preview?.candidates.fixes ?? []).map((row) => row.id)))
              }
            />
          </Tool>

          <Tool id="page" label="Page" open={openTool} onOpen={setOpenTool}>
            <div className="section-label">Paper</div>
            <div className="chip-row">
              <Chip
                on={config.orientation === 'PORTRAIT'}
                onClick={() => patch({ orientation: 'PORTRAIT' })}
              >
                Portrait
              </Chip>
              <Chip
                on={config.orientation === 'LANDSCAPE'}
                onClick={() => patch({ orientation: 'LANDSCAPE' })}
              >
                Landscape
              </Chip>
            </div>
            <p className="hint">
              Landscape gives a table {USABLE_WIDTH_LANDSCAPE_PX - USABLE_WIDTH_PX}px more to work
              with, which is what a set of columns too wide for portrait needs.
            </p>

            <div className="divider" />

            <Field label="Title" htmlFor="report-title" hint="Left blank, the report names itself.">
              <input
                id="report-title"
                value={config.title ?? ''}
                placeholder="Asset & Purchase Planning Report"
                onChange={(event) => patch({ title: event.target.value || null }, 'title')}
              />
            </Field>
            <Field
              label="Opening note"
              htmlFor="report-intro"
              hint="Printed under the title, before the summary."
            >
              <textarea
                id="report-intro"
                rows={3}
                value={config.intro ?? ''}
                onChange={(event) => patch({ intro: event.target.value || null }, 'intro')}
              />
            </Field>
          </Tool>
        </div>

        <div className="tool-group tool-right">
          <div className="zoom">
            <button
              type="button"
              className="tool-icon"
              onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}
              disabled={zoom <= 0.5}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="zoom-value">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="tool-icon"
              onClick={() => setZoom((value) => Math.min(1.6, Math.round((value + 0.1) * 10) / 10))}
              disabled={zoom >= 1.6}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>

          <button
            type="button"
            className={`tool-btn${editing ? ' is-on' : ''}`}
            onClick={() => setEditing((value) => !value)}
            title="Hide the editing handles and see the document as it will print"
          >
            {editing ? 'Editing' : 'Clean view'}
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={generate}
            disabled={pdfBusy}
          >
            {pdfBusy ? 'Generating…' : 'Generate PDF'}
          </button>
        </div>
      </div>

      {/* --- Anything the page has to say -------------------------------- */}
      {pickedAssetIds.length > 0 ||
      notice ||
      previewError ||
      pdfError ||
      pdfDone ||
      preview?.warnings.length ? (
        <div className="studio-notes">
          {pickedAssetIds.length > 0 ? (
            <div className="picked-strip">
              <strong>
                {pickedAssetIds.length} asset{pickedAssetIds.length === 1 ? '' : 's'} picked on the
                Assets screen
              </strong>
              <span className="hint">
                The filters narrow further within these, and the departments run on down the page
                rather than each starting a new one. Repairs follow the machines; purchase requests
                belong to a department, so they are not narrowed.
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPickedAssetIds([])}
              >
                Report on everything instead
              </button>
            </div>
          ) : null}

          {notice ? <Alert kind="info">{notice}</Alert> : null}
          {previewError ? <Alert>{previewError}</Alert> : null}
          {pdfError ? <Alert>{pdfError}</Alert> : null}
          {pdfDone ? <Alert kind="ok">Report generated and downloaded.</Alert> : null}
          {preview?.warnings.length ? <Alert kind="warn">{preview.warnings.join(' ')}</Alert> : null}
        </div>
      ) : null}

      {/* --- The page, and what is selected on it ------------------------ */}
      <div className="studio-body">
        <div className={`studio-canvas${previewBusy ? ' is-busy' : ''}`}>
          {preview ? (
            <iframe
              ref={frameRef}
              title="Report preview"
              srcDoc={preview.html}
              /* Scripts, and nothing else: an opaque origin that cannot reach
                 this page, its cookies or its storage. With the handles off it
                 goes back to no scripts at all. */
              sandbox={editing ? 'allow-scripts' : ''}
              className="canvas-frame"
              style={{
                width: `${100 / zoom}%`,
                height: `${100 / zoom}%`,
                transform: `scale(${zoom})`,
              }}
            />
          ) : (
            <div className="preview-placeholder">Building the page…</div>
          )}
        </div>

        <aside className="studio-side">
          <div className="side-head">
            <h2>{selection ? describe(selection.id) : 'The page'}</h2>
            <span className="muted">
              {previewBusy
                ? 'Updating…'
                : preview
                  ? `${preview.totals.assetCount} assets · ${preview.totals.groupCount} group${
                      preview.totals.groupCount === 1 ? '' : 's'
                    }`
                  : ''}
            </span>
          </div>

          <div className="side-body">
            {!selection ? (
              <>
                <p className="hint" style={{ marginTop: 0 }}>
                  Click anything on the page to work on it. Every block gets a bar: <b>✎</b> to
                  edit it here, <b>⠿</b> to drag it somewhere else, <b>✕</b> to take it off.
                </p>
                <ul className="side-tips">
                  <li>Drag the join between two column headers to move width between them.</li>
                  <li>The ✕ on a column header drops that column from the table.</li>
                  <li>The ✕ at the end of a row leaves that row out of this report.</li>
                  <li>Double-click the title, the opening note, or anything you added to type into it.</li>
                  <li>Ctrl+Z undoes, Ctrl+Shift+Z puts it back.</li>
                </ul>
              </>
            ) : null}

            {selectedBlock ? (
              <>
                <div className="section-label">{BLOCK_TYPE_LABELS[selectedBlock.type]}</div>

                {selectedBlock.type === 'TEXT' || selectedBlock.type === 'HEADING' ? (
                  <>
                    <Field
                      label="Words"
                      htmlFor="block-text"
                      hint="Or double-click it on the page and type there."
                    >
                      <textarea
                        id="block-text"
                        rows={selectedBlock.type === 'HEADING' ? 2 : 5}
                        value={selectedBlock.text ?? ''}
                        onChange={(event) =>
                          setBlock(
                            selectedBlock.id,
                            { text: event.target.value || null },
                            `text:${selectedBlock.id}`,
                          )
                        }
                      />
                    </Field>

                    <div className="section-label">Alignment</div>
                    <div className="chip-row">
                      {BLOCK_ALIGNMENTS.map((align) => (
                        <Chip
                          key={align}
                          on={selectedBlock.align === align}
                          onClick={() => setBlock(selectedBlock.id, { align })}
                        >
                          {ALIGN_LABELS[align]}
                        </Chip>
                      ))}
                    </div>

                    <div className="section-label" style={{ marginTop: 12 }}>
                      Size
                    </div>
                    <div className="chip-row">
                      {BLOCK_SIZES.map((size) => (
                        <Chip
                          key={size}
                          on={selectedBlock.size === size}
                          onClick={() => setBlock(selectedBlock.id, { size })}
                        >
                          {SIZE_LABELS[size]}
                        </Chip>
                      ))}
                    </div>
                  </>
                ) : null}

                {selectedBlock.type === 'SPACER' ? (
                  <Field
                    label={`Height - ${selectedBlock.height}px`}
                    htmlFor="block-height"
                    hint="At the page's own scale, so it is the gap that prints."
                  >
                    <input
                      id="block-height"
                      type="range"
                      min={4}
                      max={200}
                      step={2}
                      value={selectedBlock.height}
                      onChange={(event) =>
                        setBlock(
                          selectedBlock.id,
                          { height: Number(event.target.value) },
                          `height:${selectedBlock.id}`,
                        )
                      }
                    />
                  </Field>
                ) : null}

                {selectedBlock.type === 'BREAK' ? (
                  <p className="hint">Whatever follows this starts on a fresh page.</p>
                ) : null}
                {selectedBlock.type === 'DIVIDER' ? (
                  <p className="hint">A rule across the width of the page.</p>
                ) : null}

                <div className="divider" />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => removeBlock(selectedBlock.id)}
                >
                  Delete this block
                </button>
              </>
            ) : null}

            {selection && !selectedBlock ? (
              <>
                {selection.id === 'TITLE' ? (
                  <>
                    <Field
                      label="Title"
                      htmlFor="ins-title"
                      hint="Left blank, the report names itself."
                    >
                      <input
                        id="ins-title"
                        value={config.title ?? ''}
                        placeholder="Asset & Purchase Planning Report"
                        onChange={(event) => patch({ title: event.target.value || null }, 'title')}
                      />
                    </Field>
                    <Field
                      label="Opening note"
                      htmlFor="ins-intro"
                      hint="Printed under the title, before the summary."
                    >
                      <textarea
                        id="ins-intro"
                        rows={3}
                        value={config.intro ?? ''}
                        onChange={(event) => patch({ intro: event.target.value || null }, 'intro')}
                      />
                    </Field>
                    <div className="section-label">Parts of this block</div>
                    {partRow('TITLE:scope', 'The line saying what it covers')}
                    {partRow('TITLE:meta', 'Generated, prepared by, coverage, filter')}
                  </>
                ) : null}

                {selection.id === 'MASTHEAD'
                  ? partRow('MASTHEAD:right', 'Report type and date, on the right')
                  : null}

                {selection.id === 'SUMMARY' ? (
                  <>
                    <div className="section-label">Figures</div>
                    {partRow('SUMMARY:kpi:tracked', 'Assets tracked')}
                    {partRow('SUMMARY:kpi:attention', 'Need attention')}
                    {partRow('SUMMARY:kpi:awaiting', 'Awaiting decision')}
                    {partRow('SUMMARY:kpi:spend', 'Estimated spend')}
                    <div className="divider" />
                    {partRow('SUMMARY:chart', 'Condition bar')}
                    {partRow('SUMMARY:value', 'Recorded value line')}
                  </>
                ) : null}

                {selection.id === 'GROUPS' ? (
                  <>
                    <div className="section-label">Break the equipment up by</div>
                    <div className="chip-row">
                      {GROUP_BY_ORDER.map((groupBy) => (
                        <Chip
                          key={groupBy}
                          on={config.groupBy === groupBy}
                          onClick={() => patch({ groupBy })}
                        >
                          {GROUP_BY_LABELS[groupBy]}
                        </Chip>
                      ))}
                    </div>
                    {config.groupBy !== 'NONE' ? (
                      <>
                        <div className="divider" />
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={config.pageBreakPerGroup}
                            onChange={(event) => patch({ pageBreakPerGroup: event.target.checked })}
                          />
                          Start each {GROUP_BY_LABELS[config.groupBy].toLowerCase()} on a new page
                        </label>
                        <p className="hint">
                          Off, they run on down the page one after another.
                        </p>
                      </>
                    ) : null}
                  </>
                ) : null}

                {selection.id.startsWith('group:') && !selectedSection ? (
                  <>
                    <p className="hint" style={{ marginTop: 0 }}>
                      Parts of this one group. Taking one off leaves the others alone.
                    </p>
                    {partRow(`group:${groupKeyOf(selection.id)}:header`, 'Heading and description')}
                    {partRow(`group:${groupKeyOf(selection.id)}:stats`, 'The four figures')}
                    {partRow(`group:${groupKeyOf(selection.id)}:chart`, 'Condition bar')}
                    <div className="divider" />
                    <div className="section-label">Its tables</div>
                    {perGroupSections(config).map((section) =>
                      partRow(
                        `group:${groupKeyOf(selection.id)}:${section.key}`,
                        SECTION_META[section.key].label,
                      ),
                    )}
                  </>
                ) : null}

                {selectedSection && selectedColumnSet ? (
                  <>
                    <p className="hint" style={{ marginTop: 0 }}>
                      These are the {SECTION_META[selectedSection].label.toLowerCase()} columns
                      wherever that table appears.
                    </p>
                    <ColumnEditor
                      usablePx={usableWidthPx(config.orientation)}
                      registry={selectedColumnSet}
                      columns={selectedColumns}
                      onChange={(columns) => setSection(selectedSection, { columns })}
                    />
                  </>
                ) : null}

                <div className="divider" />
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeBlock(selection.id)}
                  >
                    Take off the page
                  </button>
                  {removedItems.includes(selection.id) ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => bringBack(selection.id)}
                    >
                      Put back
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      {saveOpen ? (
        <SaveAsDialog
          busy={saveBusy}
          error={saveError}
          onCancel={() => setSaveOpen(false)}
          onSave={saveAs}
        />
      ) : null}

      {deleting && currentReport ? (
        <ConfirmDialog
          title={`Delete "${currentReport.name}"?`}
          message="Everyone loses this saved setup. Reports already generated from it are unaffected."
          busy={saveBusy}
          error={saveError}
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reordering
//
// Native HTML5 drag and drop rather than a library: two short lists, one
// browser, and nothing here is worth a dependency. Every list also carries
// move buttons, because dragging reaches nobody on a keyboard.
// ---------------------------------------------------------------------------

function useReorder(onMove: (from: number, to: number) => void) {
  const from = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return {
    over,
    itemProps: (index: number) => ({
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        from.current = index;
        event.dataTransfer.effectAllowed = 'move';
        // Firefox refuses to start a drag without data on the transfer.
        event.dataTransfer.setData('text/plain', String(index));
      },
      onDragEnter: () => setOver(index),
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        if (from.current !== null && from.current !== index) onMove(from.current, index);
        from.current = null;
        setOver(null);
      },
      onDragEnd: () => {
        from.current = null;
        setOver(null);
      },
    }),
  };
}

function moveWithin<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// ---------------------------------------------------------------------------
// The tool bar
//
// One panel at a time, hanging off the button that opened it, rather than a
// rail down the side of the screen: the page being laid out is the thing that
// wants the width, and a tool is only needed while it is being used.
// ---------------------------------------------------------------------------

function Tool({
  id,
  label,
  open,
  onOpen,
  wide,
  children,
}: {
  id: string;
  label: string;
  /** Which panel is open, so only one ever is. */
  open: string | null;
  onOpen: (id: string | null) => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const isOpen = open === id;

  return (
    <div className={`tool${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className={`tool-btn${isOpen ? ' is-on' : ''}`}
        aria-expanded={isOpen}
        onClick={() => onOpen(isOpen ? null : id)}
      >
        {label}
        <span className="tool-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {isOpen ? <div className={`tool-pop${wide ? ' is-wide' : ''}`}>{children}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layers
//
// The same blocks the canvas shows, as a list. Dragging on the page is the
// quick way; this is the one that works on a keyboard, and the only way to
// reach a block that is currently switched off.
// ---------------------------------------------------------------------------

type Layer = {
  id: string;
  label: string;
  sub: string;
  on: boolean;
  /** How many columns, when the block is a table. Null when it is not one. */
  columns: number | null;
};

function LayerList({
  items,
  selectedId,
  onMove,
  onToggle,
  onSelect,
}: {
  items: Layer[];
  selectedId: string | null;
  onMove: (from: number, to: number) => void;
  onToggle: (id: string, on: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const { over, itemProps } = useReorder(onMove);

  if (items.length === 0) return <p className="hint">Nothing here yet.</p>;

  return (
    <ul className="drag-list">
      {items.map((item, index) => (
        <li
          key={item.id}
          className={`drag-item${over === index ? ' is-over' : ''}${item.on ? '' : ' is-off'}${
            selectedId === item.id ? ' is-picked' : ''
          }`}
          {...itemProps(index)}
        >
          <div className="drag-row">
            <span className="drag-grip" aria-hidden="true">
              ⠿
            </span>

            <label className="checkbox drag-label">
              <input
                type="checkbox"
                checked={item.on}
                onChange={(event) => onToggle(item.id, event.target.checked)}
              />
              <span>
                <strong>{item.label}</strong>
                {item.sub ? <span className="drag-sub">{item.sub}</span> : null}
              </span>
            </label>

            <span className="drag-tools">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onSelect(item.id)}
              >
                {item.columns === null
                  ? 'Edit'
                  : `${item.columns} column${item.columns === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm icon-btn"
                onClick={() => onMove(index, index - 1)}
                disabled={index === 0}
                aria-label={`Move ${item.label} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm icon-btn"
                onClick={() => onMove(index, index + 1)}
                disabled={index === items.length - 1}
                aria-label={`Move ${item.label} down`}
              >
                ↓
              </button>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function ColumnEditor({
  usablePx,
  registry,
  columns,
  onChange,
}: {
  usablePx: number;
  registry: Record<string, ColumnMeta>;
  columns: NormalizedColumn[];
  onChange: (columns: NormalizedColumn[]) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number[] | null>(null);

  const { over, itemProps } = useReorder((from, to) => onChange(moveWithin(columns, from, to)));

  const solved = useMemo(
    () =>
      solveColumnWidths(
        columns.map((column) => column.key),
        registry,
        Object.fromEntries(
          columns
            .filter((column) => column.width !== undefined)
            .map((column) => [column.key, column.width as number]),
        ),
        usablePx,
      ),
    [columns, registry, usablePx],
  );

  const available = Object.keys(registry).filter(
    (key) => !columns.some((column) => column.key === key),
  );

  const percents = drag ?? (solved.ok ? solved.columns.map((column) => column.percent) : []);

  /** The narrowest this column may be without its cells overlapping the next. */
  const floorFor = (key: string) => Math.ceil((registry[key].hardPx / usablePx) * 100);

  function resizeBy(index: number, deltaPercent: number, commit: boolean) {
    if (!solved.ok) return;
    const base = drag ?? solved.columns.map((column) => column.percent);
    const keys = solved.columns.map((column) => column.key);

    const minLeft = floorFor(keys[index]);
    const minRight = floorFor(keys[index + 1]);

    let delta = deltaPercent;
    delta = Math.max(delta, minLeft - base[index]);
    delta = Math.min(delta, base[index + 1] - minRight);

    const next = [...base];
    next[index] = Math.round(base[index] + delta);
    // Taken from the neighbour rather than recalculated, so the row still adds
    // up to 100 however many times it is dragged.
    next[index + 1] = base[index] + base[index + 1] - next[index];

    if (commit) {
      setDrag(null);
      onChange(columns.map((column, i) => ({ ...column, width: next[i] })));
    } else {
      setDrag(next);
    }
  }

  /**
   * Drags width from one column into its neighbour.
   *
   * The listeners go on the window rather than on the divider, and there is no
   * pointer capture: the first move re-renders this editor, and a capture set
   * on an element React may touch stops delivering after that - which showed up
   * as a divider that moved 1% and then went dead. The window is always there.
   */
  function startResize(event: React.PointerEvent, index: number) {
    const bar = barRef.current;
    if (!bar || !solved.ok) return;

    event.preventDefault();

    const width = bar.getBoundingClientRect().width;
    const startX = event.clientX;
    const base = solved.columns.map((column) => column.percent);
    const keys = solved.columns.map((column) => column.key);
    const minLeft = floorFor(keys[index]);
    const minRight = floorFor(keys[index + 1]);

    setDrag(base);
    let latest = base;

    const onMove = (moveEvent: PointerEvent) => {
      let delta = ((moveEvent.clientX - startX) / width) * 100;
      delta = Math.max(delta, minLeft - base[index]);
      delta = Math.min(delta, base[index + 1] - minRight);

      const next = [...base];
      next[index] = Math.round(base[index] + delta);
      // Taken from the neighbour rather than recalculated, so the row still
      // adds up to 100 however far it is dragged.
      next[index + 1] = base[index] + base[index + 1] - next[index];
      latest = next;
      setDrag(next);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      onChange(columns.map((column, i) => ({ ...column, width: latest[i] })));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  return (
    <div className="column-editor">
      <div className="section-label">Columns - drag to reorder</div>

      <ul className="chip-list">
        {columns.map((column, index) => {
          const meta = registry[column.key];
          if (!meta) return null;
          return (
            <li
              key={column.key}
              className={`col-chip${over === index ? ' is-over' : ''}`}
              {...itemProps(index)}
              title={meta.hint}
            >
              <span className="drag-grip" aria-hidden="true">
                ⠿
              </span>
              <span className="col-chip-label">{meta.label}</span>
              <button
                type="button"
                className="col-chip-x"
                aria-label={`Remove ${meta.label}`}
                disabled={columns.length === 1}
                onClick={() => onChange(columns.filter((c) => c.key !== column.key))}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      {available.length > 0 ? (
        <div className="chip-row">
          {available.map((key) => (
            <button
              key={key}
              type="button"
              className="chip chip-add"
              title={registry[key].hint}
              onClick={() => onChange([...columns, { key }])}
            >
              + {registry[key].label}
            </button>
          ))}
        </div>
      ) : null}

      {!solved.ok ? (
        <Alert kind="warn">
          {solved.error} It needs {solved.shortfallPx}px more than an A4 page has.
        </Alert>
      ) : (
        <>
          <div className="section-label" style={{ marginTop: 12 }}>
            Widths - drag a divider
          </div>
          <div className="width-bar" ref={barRef}>
            {solved.columns.map((column, index) => (
              <Fragment key={column.key}>
                <div className="width-seg" style={{ width: `${percents[index]}%` }}>
                  <span className="width-name">{column.meta.label}</span>
                  <span className="width-pct">{percents[index]}%</span>
                </div>
                {index < solved.columns.length - 1 ? (
                  <div
                    className="width-grip"
                    role="separator"
                    tabIndex={0}
                    aria-label={`Width between ${column.meta.label} and ${solved.columns[index + 1].meta.label}`}
                    onPointerDown={(event) => startResize(event, index)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        resizeBy(index, -1, true);
                      }
                      if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        resizeBy(index, 1, true);
                      }
                    }}
                  >
                    <span aria-hidden="true" />
                  </div>
                ) : null}
              </Fragment>
            ))}
          </div>

          <div className="row-actions">
            {solved.tight.length > 0 ? (
              <span className="hint" style={{ flex: 1 }}>
                Tight fit - long words may break across lines.
              </span>
            ) : (
              <span style={{ flex: 1 }} />
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onChange(columns.map(({ key }) => ({ key })))}
              disabled={!columns.some((column) => column.width !== undefined)}
            >
              Reset widths
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chip${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PickerList({
  label,
  noun,
  hint,
  options,
  selected,
  onToggle,
  onSet,
}: {
  label: string;
  /** Singular, for the filter box. "Categories" does not shorten by rule. */
  noun: string;
  hint: string;
  options: Array<{ id: string; label: string; sub: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  onSet: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [filter, options]);

  return (
    <div className="picker">
      <div className="picker-head">
        <span className="section-label" style={{ margin: 0 }}>
          {label}
        </span>
        <span className="picker-count">
          {selected.length === 0 ? 'all' : `${selected.length} selected`}
        </span>
      </div>

      {options.length > 8 ? (
        <input
          type="search"
          className="picker-filter"
          value={filter}
          placeholder={`Find a ${noun}`}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}

      <div className="picker-list">
        {shown.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            Nothing matches.
          </p>
        ) : (
          shown.map((option) => (
            <label key={option.id} className="checkbox picker-row">
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => onToggle(option.id)}
              />
              <span className="picker-text">
                {option.label}
                {option.sub ? <span className="picker-sub">{option.sub}</span> : null}
              </span>
            </label>
          ))
        )}
      </div>

      <div className="row-actions">
        <span className="hint" style={{ flex: 1 }}>
          {hint}
        </span>
        {selected.length > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSet([])}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RowPicker({
  title,
  rows,
  excluded,
  onToggle,
  onAll,
  onNone,
}: {
  title: string;
  rows: Candidate[];
  excluded: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const included = rows.filter((row) => !excluded.has(row.id)).length;

  // Grouped the way the report itself is grouped, so what is on screen reads in
  // the same order as the document being built.
  const grouped = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    for (const row of rows) {
      const list = map.get(row.group);
      if (list) list.push(row);
      else map.set(row.group, [row]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="row-picker">
      <button
        type="button"
        className="row-picker-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="row-picker-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <strong>{title}</strong>
        <span className="muted">
          {rows.length === 0
            ? 'nothing matched'
            : included === rows.length
              ? `all ${rows.length}`
              : `${included} of ${rows.length}`}
        </span>
      </button>

      {open ? (
        <div className="row-picker-body">
          {rows.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              Nothing matched the filters above.
            </p>
          ) : (
            <>
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onAll}>
                  Select all
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onNone}>
                  Select none
                </button>
              </div>
              <div className="row-picker-list">
                {grouped.map(([group, items]) => (
                  <div key={group}>
                    <div className="row-picker-group">{group}</div>
                    {items.map((row) => (
                      <label key={row.id} className="checkbox picker-row">
                        <input
                          type="checkbox"
                          checked={!excluded.has(row.id)}
                          onChange={() => onToggle(row.id)}
                        />
                        <span className="picker-text">
                          {row.label}
                          <span className="picker-sub">{row.sub}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SaveAsDialog({
  busy,
  error,
  onCancel,
  onSave,
}: {
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (name: string, description: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <Modal
      title="Save this report"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSave(name.trim(), description.trim())}
            disabled={busy || name.trim() === ''}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <Field
        label="Name"
        htmlFor="preset-name"
        hint="Everyone sees this in the list, so name it after what it is for."
      >
        <input
          id="preset-name"
          value={name}
          placeholder="Monthly CEO report"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() !== '') onSave(name.trim(), description.trim());
          }}
        />
      </Field>
      <Field label="Description" htmlFor="preset-note" hint="Optional.">
        <input
          id="preset-note"
          value={description}
          placeholder="What it is for, and who it goes to"
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <p className="hint" style={{ marginBottom: 0 }}>
        The filters, grouping, sections and columns are saved. The individual rows you ticked off
        are not - they name specific equipment, which changes.
      </p>
    </Modal>
  );
}
