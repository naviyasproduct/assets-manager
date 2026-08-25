'use client';

import { useEffect, useMemo, useState } from 'react';
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
  NEW_DEPARTMENT_KEY,
  stashDraft,
  takeDraft,
} from '@/lib/form-draft';
import { Field, Alert, Modal, ConfirmDialog, StatusPill, EmptyState } from '@/components/ui';
import { Combobox } from '@/components/Combobox';
import { PhotoThumb } from '@/components/PhotoThumb';

export type AssetRow = {
  id: string;
  assetTag: string;
  name: string;
  categoryId: string;
  category: string;
  categoryCode: string;
  serialNumber: string | null;
  locationId: string | null;
  locationName: string | null;
  status: AssetStatus;
  purchaseDate: string | null;
  purchaseCost: number | null;
  notes: string | null;
  departmentId: string;
  departmentName: string;
  fixCount: number;
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
  categoryId: string;
  departmentId: string;
  status: AssetStatus;
  assetTag: string;
  serialNumber: string;
  locationId: string;
  purchaseDate: string;
  purchaseCost: string;
  notes: string;
};

/** What is put aside while the user steps out to create a department. */
type AssetDraft = {
  path: string;
  form: FormState;
  editingId: string | null;
  hadPhoto: boolean;
};

/** How many already-tagged assets are shown as a reminder of the convention. */
const RECENT_TAG_COUNT = 5;
const SERIAL_SUGGESTION_COUNT = 6;

function blankForm(departmentId: string): FormState {
  return {
    name: '',
    categoryId: '',
    departmentId,
    status: 'IN_USE',
    assetTag: '',
    serialNumber: '',
    locationId: '',
    purchaseDate: '',
    purchaseCost: '',
    notes: '',
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
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'ALL'>(initialStatus ?? 'ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>(initialCategoryId ?? 'ALL');
  const [locationFilter, setLocationFilter] = useState<string>(initialLocationId ?? 'ALL');

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
  const [deleteError, setDeleteError] = useState('');

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return assets.filter((asset) => {
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
        (asset.serialNumber ?? '').toLowerCase().includes(q) ||
        (asset.locationName ?? '').toLowerCase().includes(q)
      );
    });
  }, [assets, query, statusFilter, departmentFilter, categoryFilter, locationFilter]);

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
      categoryId: asset.categoryId,
      departmentId: asset.departmentId,
      status: asset.status,
      assetTag: asset.assetTag,
      serialNumber: asset.serialNumber ?? '',
      locationId: asset.locationId ?? '',
      purchaseDate: toDateInputValue(asset.purchaseDate),
      purchaseCost: asset.purchaseCost === null ? '' : String(asset.purchaseCost),
      notes: asset.notes ?? '',
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
    // Runs once, on the way back from the department page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goCreateDepartment() {
    stashDraft(ASSET_DRAFT_KEY, {
      path: pathname,
      form,
      editingId: editing?.id ?? null,
      hadPhoto: photoFile !== null,
    } satisfies AssetDraft);

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
    const payload = {
      ...form,
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

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openCreate}
            disabled={departments.length === 0}
          >
            Add asset
          </button>
        </div>

        {assets.length === 0 ? (
          <EmptyState
            title="No assets yet"
            message="Add the equipment this department owns to start tracking its condition."
            action={
              departments.length > 0 ? (
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
            <table className="grid-table">
              <thead>
                <tr>
                  <th style={{ width: 66 }}>Photo</th>
                  <th>Tag</th>
                  <th>Asset</th>
                  <th>Category</th>
                  {showDepartmentColumn ? <th>Department</th> : null}
                  <th>Location</th>
                  <th>Status</th>
                  <th className="num">Purchased</th>
                  <th className="num">Cost</th>
                  <th className="num">Fixes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <PhotoThumb src={asset.photoUrl} name={asset.name} />
                    </td>
                    <td className="mono nowrap">{asset.assetTag}</td>
                    <td>
                      <Link href={`/assets/${asset.id}`} style={{ fontWeight: 600 }}>
                        {asset.name}
                      </Link>
                      {asset.serialNumber ? (
                        <div className="cell-sub">S/N {asset.serialNumber}</div>
                      ) : null}
                    </td>
                    <td>{asset.category}</td>
                    {showDepartmentColumn ? <td>{asset.departmentName}</td> : null}
                    <td>
                      {asset.locationId ? (
                        <Link href={`/assets?locationId=${asset.locationId}`}>
                          {asset.locationName}
                        </Link>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      <StatusPill status={asset.status} />
                    </td>
                    <td className="num nowrap">{formatDate(asset.purchaseDate)}</td>
                    <td className="num nowrap">{formatMoney(asset.purchaseCost)}</td>
                    <td className="num">
                      {asset.fixCount > 0 ? asset.fixCount : <span className="muted">-</span>}
                    </td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating || editing ? (
        <Modal
          wide
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
                      {inCategory.slice(0, RECENT_TAG_COUNT).map((asset) => (
                        <span
                          className="tag-chip"
                          key={asset.id}
                          title={`${asset.assetTag} · ${asset.name}`}
                        >
                          {asset.photoUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={asset.photoUrl} alt="" width={26} height={26} />
                          ) : (
                            <span className="tag-chip-blank" aria-hidden="true">
                              {asset.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="mono">{asset.assetTag}</span>
                        </span>
                      ))}
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

            <Field
              label="Purchase cost"
              htmlFor="asset-cost"
              error={fields.purchaseCost}
              hint="Leave blank if unknown. Used for the recorded-value figure in reports."
            >
              <input
                id="asset-cost"
                type="number"
                min="0"
                step="0.01"
                value={form.purchaseCost}
                onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })}
              />
            </Field>

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
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Remove ${deleting.name}?`}
          confirmLabel="Remove asset"
          busy={busy}
          error={deleteError}
          message={
            <>
              This permanently removes <strong>{deleting.assetTag}</strong>
              {deleting.fixCount > 0 ? (
                <>
                  {' '}
                  along with its <strong>{deleting.fixCount} repair record(s)</strong> and any
                  uploaded videos
                </>
              ) : null}
              . This cannot be undone.
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
    </>
  );
}
