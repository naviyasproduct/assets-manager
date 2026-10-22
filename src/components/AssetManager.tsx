'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { AssetStatus } from '@prisma/client';
import { api, uploadAssetPhoto } from '@/lib/client';
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUS_ORDER,
  formatMoney,
  formatDate,
  toDateInputValue,
  previewNextAssetTag,
} from '@/lib/format';
import {
  ASSET_DRAFT_KEY,
  ASSET_SELECTION_KEY,
  NEW_DEPARTMENT_KEY,
  clearDraft,
  stashDraft,
  takeDraft,
} from '@/lib/form-draft';
import { Field, Alert, FloatingWindow, ConfirmDialog, StatusPill, EmptyState } from '@/components/ui';
import { Combobox } from '@/components/Combobox';
import { AddPhotoButton, HoverablePhoto, PhotoThumb } from '@/components/PhotoThumb';
import { AssetImport } from '@/components/AssetImport';
import { ColumnPicker, useHiddenColumns, type PickableColumn } from '@/components/ColumnPicker';
import { arrangeAssets, batchKey, moveInOrder, type GroupInfo } from '@/lib/asset-order';
import { useRowSort, type SortSpot } from '@/components/useRowSort';

export type AssetRow = {
  id: string;
  assetTag: string;
  name: string;
  /** How many identical units this one record stands for. Always at least 1. */
  quantity: number;
  categoryId: string;
  category: string;
  categoryCode: string;
  serialNumber: string | null;
  locationId: string | null;
  locationName: string | null;
  status: AssetStatus;
  purchaseDate: string | null;
  /** What one unit cost. The row's value is this times quantity. */
  unitCost: number | null;
  notes: string | null;
  departmentId: string;
  departmentName: string;
  /** The batch it came in, e.g. "Milling drill"; the list labels a batch's rows with it. */
  batch: string | null;
  /** Hand-made place in the list; see lib/asset-order.ts. */
  listPosition: number | null;
  photoUrl: string | null;
  createdAt: string;
};

export type DepartmentOption = { id: string; name: string; code: string };

export type AssetCategoryOption = {
  id: string;
  name: string;
  code: string;
  departmentId: string;
  isActive: boolean;
};

/** No departmentId: a location belongs to the site, not to a department. */
export type LocationOption = { id: string; name: string; isActive: boolean };

type FormState = {
  name: string;
  quantity: string;
  categoryId: string;
  departmentId: string;
  status: AssetStatus;
  assetTag: string;
  serialNumber: string;
  locationId: string;
  purchaseDate: string;
  /** Whatever was typed into the price box - per unit or for all of them. */
  cost: string;
  costMode: CostMode;
  notes: string;
  batch: string;
};

/**
 * Receipts usually give one figure for the lot, so the price box takes either.
 * Only the per-unit figure is ever stored; a total is divided before sending.
 */
type CostMode = 'UNIT' | 'TOTAL';

/** '' stays '' (unknown). A total is divided by a valid quantity, to the cent. */
function unitCostFor(form: FormState): string {
  const cost = form.cost.trim();
  if (cost === '' || form.costMode === 'UNIT') return cost;
  const total = Number(cost);
  const quantity = Number(form.quantity);
  // Anything unparseable goes through as typed, so validation names the problem.
  if (!Number.isFinite(total) || !Number.isInteger(quantity) || quantity < 1) return cost;
  return String(Math.round((total * 100) / quantity) / 100);
}

/**
 * Says back what will be stored, in the other unit, so a total typed in never
 * turns into a per-unit figure nobody checked. A total that does not divide
 * evenly is rounded to the cent, and the hint says what that makes the total.
 */
function costHint(form: FormState): string {
  const quantity = Number(form.quantity);
  const cost = Number(form.cost);
  if (form.cost.trim() === '' || !Number.isFinite(cost) || !Number.isInteger(quantity) || quantity < 1) {
    return form.costMode === 'UNIT'
      ? 'What one unit cost. Leave blank if unknown.'
      : 'What all of them cost together. Leave blank if unknown.';
  }
  if (form.costMode === 'UNIT') {
    return quantity > 1 ? `${formatMoney(cost * quantity)} for all ${quantity}.` : 'What one unit cost.';
  }
  const unit = Number(unitCostFor(form));
  const back = unit * quantity;
  return Math.abs(back - cost) < 0.005
    ? `${formatMoney(unit)} each.`
    : `${formatMoney(unit)} each, rounded to the cent - ${formatMoney(back)} in total.`;
}

/** Every column the Columns button can hide. The tick, name and actions stay. */
const TABLE_COLUMNS: PickableColumn[] = [
  { key: 'photo', label: 'Photo' },
  { key: 'tag', label: 'Tag' },
  { key: 'quantity', label: 'Qty' },
  { key: 'category', label: 'Category' },
  { key: 'department', label: 'Department' },
  { key: 'location', label: 'Location' },
  { key: 'status', label: 'Status' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'unitCost', label: 'Unit price' },
  { key: 'totalCost', label: 'Total' },
];

/**
 * What is put aside while the form is open, so a trip to another page or
 * window - Suppliers, Reports, the sidebar, anywhere - comes back to the same
 * entries rather than a blank form. Autosaved on every change and consumed on
 * the way back in; see the effect below.
 */
type AssetDraft = {
  path: string;
  form: FormState;
  editingId: string | null;
  hadPhoto: boolean;
};

/**
 * Drags on their way to the server, shown before it answers: each touched
 * department's whole order, and any batch a dropped row joined.
 */
type Pending = {
  orders: Record<string, string[]>;
  batches: Record<string, string>;
};

const NOTHING_PENDING: Pending = { orders: {}, batches: {} };

/** How many already-tagged assets are shown as a reminder of the convention. */
const RECENT_TAG_COUNT = 3;
const SERIAL_SUGGESTION_COUNT = 6;

function blankForm(departmentId: string): FormState {
  return {
    name: '',
    quantity: '1',
    categoryId: '',
    departmentId,
    status: 'IN_USE',
    assetTag: '',
    serialNumber: '',
    locationId: '',
    purchaseDate: '',
    cost: '',
    costMode: 'UNIT',
    notes: '',
    batch: '',
  };
}

/** First three letters/digits of the name - the code people would pick anyway. */
function suggestCode(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
}

export function AssetManager({
  assets,
  departments,
  categories,
  locations,
  /** Set when the table is already scoped to one department. */
  lockedDepartmentId,
  showDepartmentColumn = true,
  initialStatus,
  initialCategoryId,
  initialLocationId,
  /** Only admins may add departments, so only they are offered the shortcut. */
  canCreateDepartment = false,
  /** Same for locations - they are admin-owned and site-wide. */
  canCreateLocation = false,
  /** View-only access: the table without add, edit or remove. */
  canEdit = true,
}: {
  assets: AssetRow[];
  departments: DepartmentOption[];
  categories: AssetCategoryOption[];
  locations: LocationOption[];
  lockedDepartmentId?: string;
  showDepartmentColumn?: boolean;
  initialStatus?: AssetStatus | 'ALL';
  initialCategoryId?: string;
  initialLocationId?: string;
  canCreateDepartment?: boolean;
  canCreateLocation?: boolean;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'ALL'>(initialStatus ?? 'ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>(initialCategoryId ?? 'ALL');
  const [locationFilter, setLocationFilter] = useState<string>(initialLocationId ?? 'ALL');

  // Ticked rows, on their way to a report. Ids rather than rows, so a
  // selection survives filtering and sorting: tick a few in Workshop, filter to
  // IT, tick a few more, and both sets are still there.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const columns = useHiddenColumns('assets.hiddenColumns');
  const shown = columns.shown;
  const pickable = showDepartmentColumn
    ? TABLE_COLUMNS
    : TABLE_COLUMNS.filter((column) => column.key !== 'department');

  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm(lockedDepartmentId ?? ''));
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [restoredNote, setRestoredNote] = useState('');

  // A category created from inside the form is usable immediately, before the
  // server components have re-rendered with it.
  const [addedCategories, setAddedCategories] = useState<AssetCategoryOption[]>([]);
  const [newCategory, setNewCategory] = useState<{ name: string; code: string } | null>(null);
  const [categoryError, setCategoryError] = useState('');
  const [categoryFields, setCategoryFields] = useState<Record<string, string>>({});
  const [savingCategory, setSavingCategory] = useState(false);

  // A location created from inside the form, same as categories above. It opens
  // a panel rather than saving the typed text outright: the create row is
  // reachable with nothing typed at all, and a location name is shared by the
  // whole site, so it is worth a look before it becomes the row everyone picks.
  const [addedLocations, setAddedLocations] = useState<LocationOption[]>([]);
  const [newLocation, setNewLocation] = useState<string | null>(null);
  const [locationError, setLocationError] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

  const [serialOpen, setSerialOpen] = useState(false);

  // Photo chosen in the form. Uploaded after the asset row exists, because a
  // brand new asset has no id to attach it to yet.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  function choosePhoto(file: File | null) {
    setPhotoFile(file);
    setRemovePhoto(false);
    setPhotoPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  const [deleting, setDeleting] = useState<AssetRow | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedNote, setImportedNote] = useState('');
  const [deleteError, setDeleteError] = useState('');

  // --- Arranging the list by hand -----------------------------------------
  // A drag shows at once from `pending`. Saves go out one at a time, in the
  // order they were made, and the server's copy only replaces `pending` once
  // the last of them is in - a reload landing between two quick drags would
  // otherwise show the first and undo the second until the next one came.
  const [pending, setPending] = useState<Pending>(NOTHING_PENDING);
  const saving = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [orderError, setOrderError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  // From a photo added straight from the list (the pen in an empty square).
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    if (saving.current === 0) setPending(NOTHING_PENDING);
  }, [assets]);

  // --- Options -------------------------------------------------------------

  const allCategories = useMemo(() => {
    const known = new Set(categories.map((category) => category.id));
    return [...categories, ...addedCategories.filter((category) => !known.has(category.id))];
  }, [categories, addedCategories]);

  const allLocations = useMemo(() => {
    const known = new Set(locations.map((location) => location.id));
    return [...locations, ...addedLocations.filter((location) => !known.has(location.id))];
  }, [locations, addedLocations]);

  /** A retired location stays listed while it is the asset's own. */
  const formLocations = useMemo(
    () =>
      allLocations.filter(
        (location) => location.isActive || location.id === form.locationId,
      ),
    [allLocations, form.locationId],
  );

  const formDepartment = departments.find((d) => d.id === form.departmentId) ?? null;

  /**
   * Categories offered for the department currently chosen in the form.
   * A retired category stays listed while it is the asset's own, so editing an
   * old machine does not quietly move it somewhere else.
   */
  const formCategories = useMemo(
    () =>
      allCategories.filter(
        (category) =>
          category.departmentId === form.departmentId &&
          (category.isActive || category.id === form.categoryId),
      ),
    [allCategories, form.departmentId, form.categoryId],
  );

  const formCategory = allCategories.find((category) => category.id === form.categoryId) ?? null;

  /** Assets already filed under the category being used, newest first. */
  const inCategory = useMemo(() => {
    if (!form.categoryId) return [];
    return assets
      .filter((asset) => asset.categoryId === form.categoryId && asset.id !== editing?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [assets, form.categoryId, editing?.id]);

  // The reminder shows different things, not five copies of the same chair:
  // the newest asset of each name, until there are enough.
  const recentTagged = useMemo(() => {
    const seen = new Set<string>();
    const out: AssetRow[] = [];
    for (const asset of inCategory) {
      const key = asset.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(asset);
      if (out.length === RECENT_TAG_COUNT) break;
    }
    return out;
  }, [inCategory]);

  const nextTag =
    formDepartment && formCategory
      ? previewNextAssetTag(
          formDepartment.code,
          formCategory.code,
          inCategory.map((asset) => asset.assetTag),
        )
      : '';

  const serialMatches = useMemo(() => {
    const typed = form.serialNumber.trim().toLowerCase();

    return inCategory
      .filter((asset) => asset.serialNumber)
      .filter((asset) => !typed || asset.serialNumber!.toLowerCase().includes(typed));
  }, [inCategory, form.serialNumber]);

  const duplicateSerial = useMemo(() => {
    const typed = form.serialNumber.trim().toLowerCase();
    if (!typed) return null;
    return inCategory.find((asset) => asset.serialNumber?.toLowerCase() === typed) ?? null;
  }, [inCategory, form.serialNumber]);

  // --- Table ---------------------------------------------------------------

  const tableCategories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of assets) {
      if (!seen.has(asset.categoryId)) seen.set(asset.categoryId, asset.category);
    }
    return [...seen]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  const tableLocations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of assets) {
      if (asset.locationId && !seen.has(asset.locationId)) {
        seen.set(asset.locationId, asset.locationName ?? '');
      }
    }
    return [...seen]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  // Arranged on every asset, not just the ones on screen, so a search neither
  // reorders nor repaints the groups.
  const liveArranged = useMemo(() => {
    const places = new Map<string, number>();
    for (const order of Object.values(pending.orders)) order.forEach((id, index) => places.set(id, index + 1));
    if (places.size === 0 && Object.keys(pending.batches).length === 0) return arrangeAssets(assets);
    return arrangeAssets(
      assets.map((asset) => ({
        ...asset,
        listPosition: places.get(asset.id) ?? asset.listPosition,
        batch: pending.batches[asset.id] ?? asset.batch,
      })),
    );
  }, [assets, pending]);

  const sort = useRowSort((drop) => void moveRow(drop.movedId, drop.targetId, drop.side, joinTarget(drop.movedId, drop)));

  // The list holds still while a row is in the air: rows reordering under
  // the pointer is what would make a drag land somewhere it was not aimed.
  const frozen = useRef(liveArranged);
  if (!sort.view) frozen.current = liveArranged;
  const arranged = sort.view ? frozen.current : liveArranged;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return arranged.ordered.filter((asset) => {
      if (statusFilter !== 'ALL' && asset.status !== statusFilter) return false;
      if (departmentFilter !== 'ALL' && asset.departmentId !== departmentFilter) return false;
      if (categoryFilter !== 'ALL' && asset.categoryId !== categoryFilter) return false;
      // 'NONE' is the one filter worth having beyond the list itself: it is how
      // you find the machines nobody has placed yet.
      if (locationFilter === 'NONE' && asset.locationId) return false;
      if (locationFilter !== 'ALL' && locationFilter !== 'NONE') {
        if (asset.locationId !== locationFilter) return false;
      }
      if (!q) return true;

      return (
        asset.name.toLowerCase().includes(q) ||
        asset.assetTag.toLowerCase().includes(q) ||
        asset.category.toLowerCase().includes(q) ||
        (asset.batch ?? '').toLowerCase().includes(q) ||
        (asset.serialNumber ?? '').toLowerCase().includes(q) ||
        (asset.locationName ?? '').toLowerCase().includes(q)
      );
    });
  }, [arranged, query, statusFilter, departmentFilter, categoryFilter, locationFilter]);

  // Departments are separate lists for dragging, so with more than one on
  // screen each gets a heading - the place a row stops is then visible.
  const departmentsShown = new Set(filtered.map((asset) => asset.departmentId)).size;

  // What a batch label spans: every column the table is showing.
  const columnCount =
    (canEdit ? 1 : 0) +
    3 +
    pickable.filter((column) => shown(column.key)).length;

  const selectedInView = filtered.filter((asset) => selected.has(asset.id));
  const allInViewSelected = filtered.length > 0 && selectedInView.length === filtered.length;

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** The header tick covers what is on screen, not the whole table. */
  function toggleAllInView() {
    setSelected((current) => {
      const next = new Set(current);
      if (allInViewSelected) for (const asset of filtered) next.delete(asset.id);
      else for (const asset of filtered) next.add(asset.id);
      return next;
    });
  }

  /**
   * Hands the ticked assets to the report builder.
   *
   * Through sessionStorage rather than the URL: two hundred cuids do not belong
   * in a link, and the selection should not outlive the tab. Same one-shot
   * hand-off the add-asset form uses - the builder takes it and it is gone.
   */
  function reportOnSelected() {
    stashDraft(ASSET_SELECTION_KEY, { assetIds: [...selected] });
    router.push('/reports?from=selection');
  }


  /**
   * The group a row dropped here would join, if any. Dropped between two rows
   * of one group, it joins that group. Dropped at a group's edge, leaning into
   * it, only a row that is in no group of its own joins - so nudging a batch
   * member past the next batch's edge never quietly re-batches it.
   */
  function joinTarget(movedId: string, spot: SortSpot): GroupInfo | null {
    const labelled = (id: string | null) => {
      const group = id ? arranged.groups.get(id) : undefined;
      return group && group.tint !== null ? group : null;
    };
    const own = arranged.groups.get(movedId);
    const above = labelled(spot.above);
    const below = labelled(spot.below);
    if (above && below && above.key === below.key) return above.key === own?.key ? null : above;
    const near = spot.nearer === 'above' ? above : below;
    if (!near || near.key === own?.key || (own && own.tint !== null)) return null;
    return near;
  }

  /**
   * Moves one row - and, dropped into a batch, puts it in that batch - then
   * saves the department's whole order. It shows in its new place at once and
   * stays there: what is saved is what comes back.
   */
  function moveRow(movedId: string, targetId: string, side: 'before' | 'after', join: GroupInfo | null = null) {
    const moved = arranged.ordered.find((asset) => asset.id === movedId);
    const target = arranged.ordered.find((asset) => asset.id === targetId);
    // A hand-made order belongs to one department; the table never offers a
    // drop across two, and this is the backstop.
    if (!moved || !target || moved.departmentId !== target.departmentId) return;

    const department = arranged.ordered
      .filter((asset) => asset.departmentId === moved.departmentId)
      .map((asset) => asset.id);
    const order = moveInOrder(department, movedId, targetId, side) ?? (join ? department : null);
    if (!order) return;

    const body = {
      departmentId: moved.departmentId,
      order,
      ...(join ? { join: { id: movedId, batch: join.label } } : {}),
    };
    setPending((current) => ({
      orders: { ...current.orders, [moved.departmentId]: order },
      batches: join ? { ...current.batches, [movedId]: join.label } : current.batches,
    }));
    setOrderError('');

    saving.current += 1;
    saveQueue.current = saveQueue.current
      .then(async () => {
        const saved = await api('/api/assets/order', { method: 'PUT', json: body });
        if (!saved.ok) setOrderError(saved.error);
      })
      .finally(() => {
        saving.current -= 1;
        // Only once nothing else is on its way: the reload then carries every
        // drag, and replaces what was shown with exactly the same thing.
        if (saving.current === 0) router.refresh();
      });
  }

  // What the held row would join if let go now, shown on it while it moves.
  const joining = sort.view ? joinTarget(sort.view.id, sort.view) : null;

  /** The keyboard route: arrow keys on the grip move a row one place. */
  function nudge(asset: AssetRow, step: -1 | 1) {
    const neighbour = filtered[filtered.indexOf(asset) + step];
    if (!neighbour || neighbour.departmentId !== asset.departmentId) return;
    moveRow(asset.id, neighbour.id, step < 0 ? 'before' : 'after');
  }

  /** Batches already used in the form's department, offered as the batch is typed. */
  const formBatches = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of assets) {
      if (asset.departmentId !== form.departmentId || !asset.batch?.trim()) continue;
      const key = batchKey(asset.batch);
      if (!seen.has(key)) seen.set(key, asset.batch.trim());
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [assets, form.departmentId]);

  /** Departments on screen that someone has arranged by hand. */
  const handOrdered = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of filtered) {
      if (asset.listPosition !== null) seen.set(asset.departmentId, asset.departmentName);
    }
    return [...seen];
  }, [filtered]);

  async function resetOrder() {
    setBusy(true);
    setResetError('');
    const result = await api('/api/assets/order', {
      method: 'DELETE',
      json: { departmentIds: handOrdered.map(([id]) => id) },
    });
    setBusy(false);
    if (!result.ok) {
      setResetError(result.error);
      return;
    }
    setResetting(false);
    router.refresh();
  }

  // --- Opening and closing the form ---------------------------------------

  function resetFormState() {
    setError('');
    setFields({});
    setRestoredNote('');
    setNewCategory(null);
    setCategoryError('');
    setCategoryFields({});
    setNewLocation(null);
    setLocationError('');
    setSerialOpen(false);
    choosePhoto(null);
  }

  function openCreate() {
    setForm(blankForm(lockedDepartmentId ?? departments[0]?.id ?? ''));
    resetFormState();
    setCreating(true);
  }

  function formStateFor(asset: AssetRow): FormState {
    return {
      name: asset.name,
      quantity: String(asset.quantity),
      categoryId: asset.categoryId,
      departmentId: asset.departmentId,
      status: asset.status,
      assetTag: asset.assetTag,
      serialNumber: asset.serialNumber ?? '',
      locationId: asset.locationId ?? '',
      purchaseDate: toDateInputValue(asset.purchaseDate),
      cost: asset.unitCost === null ? '' : String(asset.unitCost),
      costMode: 'UNIT',
      notes: asset.notes ?? '',
      batch: asset.batch ?? '',
    };
  }

  function openEdit(asset: AssetRow) {
    setForm(formStateFor(asset));
    resetFormState();
    setEditing(asset);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    resetFormState();
    clearDraft(ASSET_DRAFT_KEY);
  }

  /**
   * Coming back from "+ Create department": pick the form up exactly where it
   * was left, with the department that was just created already selected.
   */
  useEffect(() => {
    const draft = takeDraft<AssetDraft>(ASSET_DRAFT_KEY);
    if (!draft || draft.path !== pathname) return;

    const createdId = takeDraft<string>(NEW_DEPARTMENT_KEY);
    const created = createdId ? departments.find((d) => d.id === createdId) : undefined;

    // A brand new department has no categories yet, so that choice cannot carry
    // over with the rest of the form.
    const restored: FormState = created
      ? { ...draft.form, departmentId: created.id, categoryId: '' }
      : draft.form;

    setForm(restored);
    resetFormState();

    if (draft.hadPhoto) {
      setRestoredNote('Your entries were kept. Choose the photo again before saving.');
    } else if (created) {
      setRestoredNote(`${created.name} was created and selected.`);
    }

    const asset = draft.editingId
      ? (assets.find((row) => row.id === draft.editingId) ?? null)
      : null;

    if (draft.editingId && asset) setEditing(asset);
    else if (!draft.editingId) setCreating(true);
    // Runs once, on the way back from wherever the form was left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Autosaves the open form on every change, so leaving this page - by any
   * route, not only the "+ Create department" link below - and coming back
   * restores it. A closed form has nothing worth keeping, so it is cleared
   * instead (`closeForm`), and a successful save clears it the same way.
   */
  useEffect(() => {
    if (!creating && !editing) return;
    stashDraft(ASSET_DRAFT_KEY, {
      path: pathname,
      form,
      editingId: editing?.id ?? null,
      hadPhoto: photoFile !== null,
    } satisfies AssetDraft);
  }, [creating, editing, form, photoFile, pathname]);

  function goCreateDepartment() {
    router.push(`/departments/new?next=${encodeURIComponent(pathname)}`);
  }

  // --- Writes --------------------------------------------------------------

  async function createCategory() {
    if (!newCategory || !form.departmentId) return;

    setSavingCategory(true);
    setCategoryError('');
    setCategoryFields({});

    const result = await api<{ category: AssetCategoryOption }>('/api/asset-categories', {
      method: 'POST',
      json: { ...newCategory, departmentId: form.departmentId },
    });

    setSavingCategory(false);

    if (!result.ok) {
      setCategoryError(result.error);
      setCategoryFields(result.fields ?? {});
      return;
    }

    const { category } = result.data;

    setAddedCategories((current) => [...current, category]);
    setForm((current) => ({ ...current, categoryId: category.id }));
    setNewCategory(null);
    // Everything else on the page that lists categories catches up too.
    router.refresh();
  }

  /**
   * Saves the name typed into the location panel. Errors stay inside the panel
   * so the text is still there to fix - the common one is "that name already
   * exists", which is exactly the duplicate this list is here to prevent.
   */
  async function createLocation() {
    const trimmed = (newLocation ?? '').trim();
    if (!trimmed) return;

    setSavingLocation(true);
    setLocationError('');
    setFields((current) => ({ ...current, locationId: '' }));

    const result = await api<{ location: LocationOption }>('/api/locations', {
      method: 'POST',
      json: { name: trimmed },
    });

    setSavingLocation(false);

    if (!result.ok) {
      setLocationError(result.fields?.name ?? result.error);
      return;
    }

    const { location } = result.data;

    setAddedLocations((current) => [...current, location]);
    setForm((current) => ({ ...current, locationId: location.id }));
    setNewLocation(null);
    // Everything else on the page that lists locations catches up too.
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    // assetTag is only sent when the user typed one; blank means "generate the
    // next number for this department and category".
    const { cost: _cost, costMode: _costMode, ...rest } = form;
    const payload = {
      ...rest,
      unitCost: unitCostFor(form),
      assetTag: form.assetTag.trim() === '' ? null : form.assetTag.trim(),
    };

    const result = editing
      ? await api<{ asset: { id: string } }>(`/api/assets/${editing.id}`, {
          method: 'PATCH',
          json: payload,
        })
      : await api<{ asset: { id: string } }>('/api/assets', { method: 'POST', json: payload });

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    const assetId = result.data.asset.id;

    // The photo is a separate request: a new asset has no id to attach one to
    // until it exists. If this fails, the asset details are already saved - say
    // so rather than making it look like the whole save was lost.
    if (photoFile) {
      const uploaded = await uploadAssetPhoto(assetId, photoFile);
      if (!uploaded.ok) {
        setBusy(false);
        setError(`${uploaded.error} The asset details were saved without the photo.`);
        router.refresh();
        return;
      }
    } else if (removePhoto && editing?.photoUrl) {
      await api(`/api/assets/${assetId}/photo`, { method: 'DELETE' });
    }

    setBusy(false);
    closeForm();
    router.refresh();
  }

  /** The ticked rows, removed in one request - all of them or, if anything is wrong, none. */
  async function confirmBulkDelete() {
    setBusy(true);
    setDeleteError('');
    const result = await api<{ deleted: number }>('/api/assets', {
      method: 'DELETE',
      json: { ids: [...selected] },
    });
    setBusy(false);
    if (!result.ok) {
      setDeleteError(result.error);
      if (result.status === 409) router.refresh();
      return;
    }
    setBulkDeleting(false);
    setSelected(new Set());
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');

    const result = await api(`/api/assets/${deleting.id}`, { method: 'DELETE' });
    setBusy(false);

    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <div className="card">
        <div className="toolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, tag, serial…"
            aria-label="Search assets"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AssetStatus | 'ALL')}
            aria-label="Filter by status"
          >
            <option value="ALL">All statuses</option>
            {ASSET_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {ASSET_STATUS_LABELS[status]}
              </option>
            ))}
          </select>

          {tableCategories.length > 1 ? (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="ALL">All categories</option>
              {tableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          ) : null}

          {tableLocations.length > 1 ? (
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              aria-label="Filter by location"
            >
              <option value="ALL">All locations</option>
              {tableLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
              <option value="NONE">No location set</option>
            </select>
          ) : null}

          {!lockedDepartmentId && departments.length > 1 ? (
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              aria-label="Filter by department"
            >
              <option value="ALL">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          ) : null}

          <div className="toolbar-spacer" />

          <span className="muted" style={{ fontSize: 12.5 }}>
            {filtered.length} of {assets.length}
          </span>

          {canEdit && handOrdered.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setResetError('');
                setResetting(true);
              }}
              title="Undo the dragging and sort by tag and name again"
            >
              Automatic order
            </button>
          ) : null}

          <ColumnPicker
            columns={pickable}
            hidden={columns.hidden}
            onToggle={columns.toggle}
            onShowAll={columns.showAll}
          />

          {canEdit ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setImporting(true)}
              disabled={departments.length === 0}
            >
              Import from Excel
            </button>
          ) : null}

          {canEdit ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openCreate}
              disabled={departments.length === 0}
            >
              Add asset
            </button>
          ) : null}
        </div>

        {importedNote ? (
          <div style={{ padding: '12px 18px' }}>
            <Alert kind="ok">{importedNote}</Alert>
          </div>
        ) : null}

        {orderError || photoError ? (
          <div style={{ padding: '12px 18px 0' }}>
            <Alert>{orderError || photoError}</Alert>
          </div>
        ) : null}

        {selected.size > 0 ? (
          <div className="select-bar">
            <span className="select-count">
              <strong>{selected.size}</strong> asset{selected.size === 1 ? '' : 's'} selected
            </span>
            {selectedInView.length !== selected.size ? (
              <span className="muted" style={{ fontSize: 12 }}>
                {selected.size - selectedInView.length} of them outside the current filter
              </span>
            ) : null}
            <div className="toolbar-spacer" />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
            {canEdit ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setDeleteError('');
                  setBulkDeleting(true);
                }}
              >
                Delete {selected.size}
              </button>
            ) : null}
            <button type="button" className="btn btn-primary btn-sm" onClick={reportOnSelected}>
              Report on these
            </button>
          </div>
        ) : null}

        {assets.length === 0 ? (
          <EmptyState
            title="No assets yet"
            message="Add the equipment this department owns to start tracking its condition."
            action={
              canEdit && departments.length > 0 ? (
                <button type="button" className="btn btn-primary" onClick={openCreate}>
                  Add the first asset
                </button>
              ) : undefined
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches" message="No assets match the current filters." />
        ) : (
          <div className="table-wrap">
            <table className={`grid-table asset-table${canEdit ? ' is-sortable' : ''}`}>
              <thead>
                <tr>
                  {canEdit ? <th className="grip-col" aria-label="Move" /> : null}
                  <th className="tick-col">
                    <input
                      type="checkbox"
                      checked={allInViewSelected}
                      // Half-ticked when only some of what is on screen is
                      // picked, so the header never claims more than it means.
                      ref={(node) => {
                        if (node) {
                          node.indeterminate =
                            selectedInView.length > 0 && !allInViewSelected;
                        }
                      }}
                      onChange={toggleAllInView}
                      aria-label={
                        allInViewSelected ? 'Clear these assets' : 'Select these assets'
                      }
                    />
                  </th>
                  {shown('photo') ? <th style={{ width: 66 }}>Photo</th> : null}
                  {shown('tag') ? <th>Tag</th> : null}
                  <th>Asset</th>
                  {shown('quantity') ? <th className="num">Qty</th> : null}
                  {shown('category') ? <th>Category</th> : null}
                  {showDepartmentColumn && shown('department') ? <th>Department</th> : null}
                  {shown('location') ? <th>Location</th> : null}
                  {shown('status') ? <th>Status</th> : null}
                  {shown('purchased') ? <th className="num">Purchased</th> : null}
                  {shown('unitCost') ? <th className="num">Unit price</th> : null}
                  {shown('totalCost') ? <th className="num">Total</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody className={sort.view ? 'is-sorting' : undefined}>
                {filtered.map((asset, index) => {
                  const group = arranged.groups.get(asset.id);
                  const previous = index > 0 ? filtered[index - 1] : null;
                  const previousGroup = previous ? arranged.groups.get(previous.id) : null;
                  // A label over every run of a group - a batch split by a
                  // drag gets one over each part, so no row is ever unlabelled.
                  const startsDepartment = !previous || previous.departmentId !== asset.departmentId;
                  const startsGroup =
                    !!group &&
                    group.tint !== null &&
                    (startsDepartment || previousGroup?.key !== group.key);
                  const lifted = sort.view?.id === asset.id;
                  const shift = lifted ? sort.view!.dy : (sort.view?.offsets.get(asset.id) ?? 0);
                  // Held over a batch, the row already wears that batch's colour.
                  const tint = lifted && joining ? joining.tint : group?.tint ?? null;
                  const classes = [
                    selected.has(asset.id) ? 'is-selected' : '',
                    tint !== null ? `in-group grp-${tint}` : '',
                    lifted ? 'is-lifted' : '',
                  ].filter(Boolean);
                  return (
                  <Fragment key={asset.id}>
                  {startsDepartment && departmentsShown > 1 ? (
                    <tr className="dept-head" data-sort-spacer={`dept:${asset.departmentId}`}>
                      <td colSpan={columnCount}>
                        {asset.departmentName}
                      </td>
                    </tr>
                  ) : null}
                  {startsGroup ? (
                    <tr
                      className={`batch-head grp-${group!.tint}`}
                      data-sort-spacer={`label:${asset.id}`}
                      style={
                        sort.view?.offsets.get(`label:${asset.id}`)
                          ? { transform: `translateY(${sort.view.offsets.get(`label:${asset.id}`)}px)` }
                          : undefined
                      }
                    >
                      <td colSpan={columnCount}>
                        <span
                          className={`batch-tag${group!.isBatch ? '' : ' is-by-name'}`}
                          title={
                            group!.isBatch
                              ? `Batch: ${group!.label}`
                              : 'Grouped by name. Give these a batch on the asset to name the group yourself.'
                          }
                        >
                          {group!.label}
                        </span>
                        <span className="batch-count">
                          {group!.size} item{group!.size === 1 ? '' : 's'}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  <tr
                    className={classes.length > 0 ? classes.join(' ') : undefined}
                    data-sort-id={asset.id}
                    data-sort-group={asset.departmentId}
                    style={shift ? { transform: `translateY(${shift}px)` } : undefined}
                    {...(canEdit ? sort.row(asset.id, asset.departmentId) : {})}
                  >
                    {canEdit ? (
                      <td
                        className="grip-col"
                        title={
                          group && group.tint !== null
                            ? `In ${group.label}. Drag to move; arrow keys move one place.`
                            : 'Drag to move; arrow keys move one place.'
                        }
                      >
                        <button
                          type="button"
                          className="row-grip"
                          aria-label={`Move ${asset.name}`}
                          onKeyDown={(event) => {
                            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                            event.preventDefault();
                            nudge(asset, event.key === 'ArrowUp' ? -1 : 1);
                          }}
                        >
                          ⋮⋮
                        </button>
                      </td>
                    ) : null}
                    <td className="tick-col">
                      <input
                        type="checkbox"
                        checked={selected.has(asset.id)}
                        onChange={() => toggleSelected(asset.id)}
                        aria-label={`Select ${asset.name}`}
                      />
                    </td>
                    {shown('photo') ? (
                      <td>
                        {canEdit && !asset.photoUrl ? (
                          <AddPhotoButton assetId={asset.id} name={asset.name} onError={setPhotoError} />
                        ) : (
                          <PhotoThumb src={asset.photoUrl} name={asset.name} />
                        )}
                      </td>
                    ) : null}
                    {shown('tag') ? <td className="mono nowrap">{asset.assetTag}</td> : null}
                    <td className="name-cell">
                      <Link href={`/assets/${asset.id}`} style={{ fontWeight: 600 }}>
                        {asset.name}
                      </Link>
                      {lifted && joining ? <span className="join-badge">Joins {joining.label}</span> : null}
                      {asset.serialNumber ? (
                        <div className="cell-sub">S/N {asset.serialNumber}</div>
                      ) : null}
                    </td>
                    {shown('quantity') ? <td className="num">{asset.quantity}</td> : null}
                    {shown('category') ? <td>{asset.category}</td> : null}
                    {showDepartmentColumn && shown('department') ? (
                      <td>{asset.departmentName}</td>
                    ) : null}
                    {shown('location') ? (
                      <td>
                        {asset.locationId ? (
                          <Link href={`/assets?locationId=${asset.locationId}`}>
                            {asset.locationName}
                          </Link>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    ) : null}
                    {shown('status') ? (
                      <td>
                        <StatusPill status={asset.status} />
                      </td>
                    ) : null}
                    {shown('purchased') ? (
                      <td className="num nowrap">{formatDate(asset.purchaseDate)}</td>
                    ) : null}
                    {shown('unitCost') ? (
                      <td className="num nowrap">{formatMoney(asset.unitCost)}</td>
                    ) : null}
                    {shown('totalCost') ? (
                      <td className="num nowrap">
                        {formatMoney(
                          asset.unitCost === null ? null : asset.unitCost * asset.quantity,
                        )}
                      </td>
                    ) : null}
                    <td>
                      {canEdit ? (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEdit(asset)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              setDeleteError('');
                              setDeleting(asset);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating || editing ? (
        <FloatingWindow
          name="asset-form"
          title={editing ? `Edit ${editing.name}` : 'Add asset'}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="asset-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add asset'}
              </button>
            </>
          }
        >
          <form id="asset-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}
            {restoredNote ? <Alert kind="info">{restoredNote}</Alert> : null}

            <div className="field-row">
              <Field label="Asset name" htmlFor="asset-name" error={fields.name}>
                <input
                  id="asset-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoFocus
                  required
                />
              </Field>

              <Field
                label="Department"
                htmlFor="asset-department"
                error={fields.departmentId}
                hint={lockedDepartmentId ? undefined : 'Who owns the machine.'}
              >
                <Combobox
                  id="asset-department"
                  value={form.departmentId}
                  disabled={Boolean(lockedDepartmentId) || busy}
                  options={departments.map((department) => ({
                    id: department.id,
                    label: department.name,
                    hint: department.code,
                  }))}
                  placeholder="Choose a department"
                  onChange={(departmentId) =>
                    setForm((current) => ({
                      ...current,
                      departmentId,
                      // Categories belong to one department, so the old choice
                      // cannot survive a move.
                      categoryId:
                        allCategories.find((c) => c.id === current.categoryId)?.departmentId ===
                        departmentId
                          ? current.categoryId
                          : '',
                    }))
                  }
                  createLabel={canCreateDepartment ? 'Create department' : undefined}
                  onCreate={canCreateDepartment ? goCreateDepartment : undefined}
                />
              </Field>
            </div>

            <Field
              label="Batch"
              htmlFor="asset-batch"
              error={fields.batch}
              hint={
                formBatches.length > 0
                  ? 'Optional. Items that came together share one - pick one already used, or type a new one.'
                  : 'Optional. Items that came together - the same tool in several sizes - share one, e.g. Milling drill.'
              }
            >
              <input
                id="asset-batch"
                type="text"
                value={form.batch}
                maxLength={80}
                list="asset-batches"
                autoComplete="off"
                placeholder="e.g. Milling drill"
                onChange={(e) => setForm({ ...form, batch: e.target.value })}
              />
              {/* Suggestions, not a constraint: a new batch is just typed. Case
                  never splits one ("milling drill" is "Milling drill"). */}
              <datalist id="asset-batches">
                {formBatches.map((batch) => (
                  <option key={batch} value={batch} />
                ))}
              </datalist>
            </Field>

            <div className="field-row">
              <Field
                label="Category"
                htmlFor="asset-category"
                error={fields.categoryId}
                hint={
                  formDepartment
                    ? `Groups of equipment inside ${formDepartment.name}, e.g. Nuts, Presses.`
                    : 'Choose a department first.'
                }
              >
                <Combobox
                  id="asset-category"
                  value={form.categoryId}
                  disabled={!form.departmentId || busy}
                  options={formCategories.map((category) => ({
                    id: category.id,
                    label: category.name,
                    hint: category.code,
                  }))}
                  placeholder={
                    formCategories.length === 0
                      ? 'No categories yet - create one'
                      : 'Search categories'
                  }
                  emptyText="No category matches."
                  onChange={(categoryId) => setForm((current) => ({ ...current, categoryId }))}
                  createLabel="Create asset category"
                  onCreate={(typed) => {
                    setCategoryError('');
                    setCategoryFields({});
                    setNewCategory({ name: typed, code: suggestCode(typed) });
                  }}
                />
              </Field>

              <Field label="Status" htmlFor="asset-status" error={fields.status}>
                <select
                  id="asset-status"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as AssetStatus })}
                >
                  {ASSET_STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {ASSET_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {newCategory ? (
              <div className="inline-panel">
                <div className="inline-panel-head">
                  New category in {formDepartment?.name ?? 'this department'}
                </div>

                {categoryError ? <Alert>{categoryError}</Alert> : null}

                <div className="field-row">
                  <Field label="Name" htmlFor="new-category-name" error={categoryFields.name}>
                    <input
                      id="new-category-name"
                      type="text"
                      value={newCategory.name}
                      autoFocus
                      onChange={(e) =>
                        setNewCategory((current) =>
                          current
                            ? {
                                name: e.target.value,
                                // Keeps following the name until it is edited by hand.
                                code:
                                  current.code === suggestCode(current.name)
                                    ? suggestCode(e.target.value)
                                    : current.code,
                              }
                            : current,
                        )
                      }
                    />
                  </Field>

                  <Field
                    label="Code"
                    htmlFor="new-category-code"
                    error={categoryFields.code}
                    hint={
                      formDepartment && newCategory.code
                        ? `Assets will be tagged ${formDepartment.code}-${newCategory.code}-001.`
                        : 'Two or more letters or numbers, e.g. NUT.'
                    }
                  >
                    <input
                      id="new-category-code"
                      type="text"
                      className="mono"
                      value={newCategory.code}
                      maxLength={10}
                      onChange={(e) =>
                        setNewCategory((current) =>
                          current ? { ...current, code: e.target.value.toUpperCase() } : current,
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={createCategory}
                    disabled={savingCategory || !newCategory.name.trim() || !newCategory.code.trim()}
                  >
                    {savingCategory ? 'Creating…' : 'Create category'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setNewCategory(null)}
                    disabled={savingCategory}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            <div className="field-row">
              <Field label="Asset tag" htmlFor="asset-tag" error={fields.assetTag}>
                <input
                  id="asset-tag"
                  type="text"
                  className="mono"
                  value={form.assetTag}
                  onChange={(e) => setForm({ ...form, assetTag: e.target.value })}
                  placeholder={editing ? undefined : nextTag || 'Auto'}
                />

                {/* Hand-rolled rather than Field's own hint so it stays directly
                    under the input, above the examples. */}
                {!editing && !fields.assetTag ? (
                  <div className="hint">
                    {nextTag
                      ? `Leave blank and it becomes ${nextTag}.`
                      : 'Leave blank to number it automatically.'}
                  </div>
                ) : null}

                {!editing && inCategory.length > 0 ? (
                  <div className="tag-recent">
                    <div className="tag-recent-label">Last tagged in {formCategory?.name}</div>
                    <div className="tag-chips">
                      {recentTagged.map((asset) =>
                        asset.photoUrl ? (
                          <HoverablePhoto
                            key={asset.id}
                            src={asset.photoUrl}
                            name={`${asset.assetTag} · ${asset.name}`}
                            className="tag-chip tag-chip-btn"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={asset.photoUrl} alt="" width={26} height={26} />
                            <span className="mono">{asset.assetTag}</span>
                          </HoverablePhoto>
                        ) : (
                          <span className="tag-chip" key={asset.id} title={`${asset.assetTag} · ${asset.name}`}>
                            <span className="tag-chip-blank" aria-hidden="true">
                              {asset.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="mono">{asset.assetTag}</span>
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}
              </Field>

              <Field
                label="Serial number"
                htmlFor="asset-serial"
                error={fields.serialNumber}
                hint={
                  inCategory.some((asset) => asset.serialNumber)
                    ? 'Serials already recorded in this category appear as you type.'
                    : undefined
                }
              >
                <div className="suggest-anchor">
                  <input
                    id="asset-serial"
                    type="text"
                    value={form.serialNumber}
                    onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                    onFocus={() => setSerialOpen(true)}
                    onBlur={() => setSerialOpen(false)}
                    placeholder="Optional"
                    autoComplete="off"
                  />

                  {serialOpen && serialMatches.length > 0 ? (
                    <div className="suggest">
                      <div className="suggest-head">
                        In {formCategory?.name ?? 'this category'}
                      </div>
                      <ul>
                        {serialMatches.slice(0, SERIAL_SUGGESTION_COUNT).map((asset) => (
                          <li key={asset.id}>
                            <span className="mono">{asset.serialNumber}</span>
                            <span className="muted">{asset.assetTag}</span>
                          </li>
                        ))}
                      </ul>
                      {serialMatches.length > SERIAL_SUGGESTION_COUNT ? (
                        <div className="suggest-more">
                          +{serialMatches.length - SERIAL_SUGGESTION_COUNT} more
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {duplicateSerial ? (
                  <div className="warn-note">
                    {duplicateSerial.assetTag} already has this serial number.
                  </div>
                ) : null}
              </Field>
            </div>

            <div className="field-row">
              <Field
                label="Location"
                htmlFor="asset-location"
                error={fields.locationId}
                hint={
                  canCreateLocation
                    ? 'Where the machine physically stands. Shared across departments.'
                    : 'Optional. Managed by an administrator on the Locations screen.'
                }
              >
                <Combobox
                  id="asset-location"
                  value={form.locationId}
                  disabled={busy || savingLocation}
                  options={formLocations.map((location) => ({
                    id: location.id,
                    label: location.name,
                  }))}
                  placeholder={
                    formLocations.length === 0
                      ? canCreateLocation
                        ? 'No locations yet - create one'
                        : 'No locations set up yet'
                      : savingLocation
                        ? 'Creating…'
                        : 'Optional - search locations'
                  }
                  emptyText="No location matches."
                  onChange={(locationId) => setForm((current) => ({ ...current, locationId }))}
                  createLabel={canCreateLocation ? 'Create location' : undefined}
                  onCreate={
                    canCreateLocation
                      ? (typed) => {
                          setLocationError('');
                          setNewLocation(typed);
                        }
                      : undefined
                  }
                />

                {form.locationId ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 6 }}
                    onClick={() => setForm({ ...form, locationId: '' })}
                  >
                    Clear location
                  </button>
                ) : null}
              </Field>

              <Field
                label="Purchase date"
                htmlFor="asset-date"
                error={fields.purchaseDate}
                hint="Leave blank if unknown."
              >
                <input
                  id="asset-date"
                  type="date"
                  value={form.purchaseDate}
                  onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
                />
              </Field>
            </div>

            {newLocation !== null ? (
              <div className="inline-panel">
                <div className="inline-panel-head">New location</div>

                {locationError ? <Alert>{locationError}</Alert> : null}

                <Field
                  label="Name"
                  htmlFor="new-location-name"
                  hint="A physical place, e.g. Shed B. Every department picks from the same list, so name it the way the whole site would."
                >
                  <input
                    id="new-location-name"
                    type="text"
                    value={newLocation}
                    maxLength={120}
                    autoFocus
                    onChange={(e) => setNewLocation(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter here means "create this location", not "submit the asset".
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void createLocation();
                      }
                    }}
                  />
                </Field>

                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={createLocation}
                    disabled={savingLocation || !newLocation.trim()}
                  >
                    {savingLocation ? 'Creating…' : 'Create location'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setNewLocation(null);
                      setLocationError('');
                    }}
                    disabled={savingLocation}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            <div className="field-row">
              <Field
                label="How many"
                htmlFor="asset-quantity"
                error={fields.quantity}
                hint="Identical units kept as one record - five of the same chair are one row, not five."
              >
                <input
                  id="asset-quantity"
                  type="number"
                  min="0"
                  step="1"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </Field>

              <Field
                label={form.costMode === 'UNIT' ? 'Unit price' : 'Total price'}
                htmlFor="asset-cost"
                error={fields.unitCost}
                hint={costHint(form)}
              >
                <div className="cost-input">
                  <input
                    id="asset-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  />
                  <div className="switch" role="radiogroup" aria-label="Price entered as">
                    {(['UNIT', 'TOTAL'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={form.costMode === mode}
                        className={form.costMode === mode ? 'is-on' : undefined}
                        onClick={() => setForm({ ...form, costMode: mode })}
                      >
                        {mode === 'UNIT' ? 'Per unit' : 'Total'}
                      </button>
                    ))}
                  </div>
                </div>
              </Field>
            </div>

            <Field
              label="Photo"
              htmlFor="asset-photo"
              hint="Optional. Shown in the asset table and in the PDF report. Large photos are shrunk automatically before upload."
            >
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                {photoPreview ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={photoPreview} alt="" className="thumb thumb-lg" />
                ) : editing?.photoUrl && !removePhoto ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={editing.photoUrl} alt="" className="thumb thumb-lg" />
                ) : (
                  <div className="thumb thumb-lg thumb-empty" aria-hidden="true">
                    -
                  </div>
                )}

                <div style={{ flex: 1, minWidth: 180 }}>
                  <input
                    id="asset-photo"
                    type="file"
                    accept="image/*"
                    onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
                    disabled={busy}
                  />
                  {editing?.photoUrl && !photoFile ? (
                    <label className="checkbox" style={{ marginTop: 8 }}>
                      <input
                        type="checkbox"
                        checked={removePhoto}
                        onChange={(e) => setRemovePhoto(e.target.checked)}
                      />
                      Remove the current photo
                    </label>
                  ) : null}
                </div>
              </div>
            </Field>

            <Field
              label="Notes"
              htmlFor="asset-notes"
              error={fields.notes}
              hint="Appears under the asset name in the PDF report."
            >
              <textarea
                id="asset-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </form>
        </FloatingWindow>
      ) : null}

      {importing ? (
        <AssetImport
          onClose={() => setImporting(false)}
          onImported={(tags) => {
            setImporting(false);
            setImportedNote(
              `Added ${tags.length} asset${tags.length === 1 ? '' : 's'} from the sheet` +
                (tags.length > 0 ? ` (${tags[0]}${tags.length > 1 ? ` … ${tags[tags.length - 1]}` : ''})` : '') +
                '. Open each one with Edit to add its photo.',
            );
            router.refresh();
          }}
        />
      ) : null}

      {resetting ? (
        <ConfirmDialog
          title="Go back to the automatic order?"
          confirmLabel="Sort automatically"
          busy={busy}
          error={resetError}
          message={
            <>
              Everything dragged by hand in{' '}
              <strong>{handOrdered.map(([, name]) => name).join(', ')}</strong> goes back to being
              sorted by tag and name, for everyone.
              <br />
              <br />
              Assets you dragged into a group stay in that group.
            </>
          }
          onConfirm={resetOrder}
          onCancel={() => setResetting(false)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Remove ${deleting.name}?`}
          confirmLabel="Remove asset"
          busy={busy}
          error={deleteError}
          message={
            <>
              This permanently removes <strong>{deleting.assetTag}</strong>. This cannot be
              undone.
              <br />
              <br />
              If the machine is simply out of service, set its status to{' '}
              <strong>Broken</strong> or <strong>Needs replacement</strong> instead so it still
              appears in reports.
            </>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {bulkDeleting ? (
        <ConfirmDialog
          title={`Delete ${selected.size} asset${selected.size === 1 ? '' : 's'}?`}
          confirmLabel={`Delete ${selected.size}`}
          busy={busy}
          error={deleteError}
          message={
            <>
              These are removed for good, with their photos and any stock history:
              <span className="bulk-delete-list">
                {assets
                  .filter((asset) => selected.has(asset.id))
                  .slice(0, 8)
                  .map((asset) => (
                    <span key={asset.id}>
                      <span className="mono">{asset.assetTag}</span> {asset.name}
                    </span>
                  ))}
                {selected.size > 8 ? <span className="muted">and {selected.size - 8} more</span> : null}
              </span>
              Anything only out of service is better set to <strong>Broken</strong> or{' '}
              <strong>Needs replacement</strong>, so it stays in reports.
            </>
          }
          onCancel={() => setBulkDeleting(false)}
          onConfirm={confirmBulkDelete}
        />
      ) : null}
    </>
  );
}
