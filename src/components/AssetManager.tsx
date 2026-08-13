'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AssetStatus } from '@prisma/client';
import { api, uploadAssetPhoto } from '@/lib/client';
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUS_ORDER,
  formatMoney,
  formatDate,
  toDateInputValue,
} from '@/lib/format';
import { Field, Alert, Modal, ConfirmDialog, StatusPill, EmptyState } from '@/components/ui';

export type AssetRow = {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  serialNumber: string | null;
  location: string | null;
  status: AssetStatus;
  purchaseDate: string | null;
  purchaseCost: number | null;
  notes: string | null;
  departmentId: string;
  departmentName: string;
  fixCount: number;
  photoUrl: string | null;
};

export type DepartmentOption = { id: string; name: string };

type FormState = {
  name: string;
  category: string;
  departmentId: string;
  status: AssetStatus;
  assetTag: string;
  serialNumber: string;
  location: string;
  purchaseDate: string;
  purchaseCost: string;
  notes: string;
};

function blankForm(departmentId: string): FormState {
  return {
    name: '',
    category: '',
    departmentId,
    status: 'IN_USE',
    assetTag: '',
    serialNumber: '',
    location: '',
    purchaseDate: '',
    purchaseCost: '',
    notes: '',
  };
}

export function AssetManager({
  assets,
  departments,
  /** Set when the table is already scoped to one department. */
  lockedDepartmentId,
  showDepartmentColumn = true,
  initialStatus,
}: {
  assets: AssetRow[];
  departments: DepartmentOption[];
  lockedDepartmentId?: string;
  showDepartmentColumn?: boolean;
  initialStatus?: AssetStatus | 'ALL';
}) {
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | 'ALL'>(initialStatus ?? 'ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm(lockedDepartmentId ?? ''));
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

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

  const categories = useMemo(
    () => Array.from(new Set(assets.map((a) => a.category))).sort(),
    [assets],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return assets.filter((asset) => {
      if (statusFilter !== 'ALL' && asset.status !== statusFilter) return false;
      if (departmentFilter !== 'ALL' && asset.departmentId !== departmentFilter) return false;
      if (categoryFilter !== 'ALL' && asset.category !== categoryFilter) return false;
      if (!q) return true;

      return (
        asset.name.toLowerCase().includes(q) ||
        asset.assetTag.toLowerCase().includes(q) ||
        asset.category.toLowerCase().includes(q) ||
        (asset.serialNumber ?? '').toLowerCase().includes(q) ||
        (asset.location ?? '').toLowerCase().includes(q)
      );
    });
  }, [assets, query, statusFilter, departmentFilter, categoryFilter]);

  function openCreate() {
    setForm(blankForm(lockedDepartmentId ?? departments[0]?.id ?? ''));
    setError('');
    setFields({});
    choosePhoto(null);
    setCreating(true);
  }

  function openEdit(asset: AssetRow) {
    setForm({
      name: asset.name,
      category: asset.category,
      departmentId: asset.departmentId,
      status: asset.status,
      assetTag: asset.assetTag,
      serialNumber: asset.serialNumber ?? '',
      location: asset.location ?? '',
      purchaseDate: toDateInputValue(asset.purchaseDate),
      purchaseCost: asset.purchaseCost === null ? '' : String(asset.purchaseCost),
      notes: asset.notes ?? '',
    });
    setError('');
    setFields({});
    choosePhoto(null);
    setEditing(asset);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    choosePhoto(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    // assetTag is only sent when the user typed one; blank means "generate the
    // next number for this department".
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

          {categories.length > 1 ? (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="ALL">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
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
                      {asset.photoUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={asset.photoUrl}
                          alt=""
                          className="thumb"
                          loading="lazy"
                          width={50}
                          height={50}
                        />
                      ) : (
                        <div className="thumb thumb-empty" aria-hidden="true">
                          {asset.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
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
                    <td>{asset.location ?? <span className="muted">-</span>}</td>
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
                label="Category"
                htmlFor="asset-category"
                error={fields.category}
                hint="e.g. Printing press, Machine tool, Workstation"
              >
                <input
                  id="asset-category"
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  list="asset-categories"
                  required
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="Department" htmlFor="asset-department" error={fields.departmentId}>
                <select
                  id="asset-department"
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  required
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
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

            <div className="field-row">
              <Field
                label="Asset tag"
                htmlFor="asset-tag"
                error={fields.assetTag}
                hint={editing ? undefined : 'Leave blank to number it automatically.'}
              >
                <input
                  id="asset-tag"
                  type="text"
                  value={form.assetTag}
                  onChange={(e) => setForm({ ...form, assetTag: e.target.value })}
                  placeholder={editing ? undefined : 'Auto'}
                />
              </Field>

              <Field label="Serial number" htmlFor="asset-serial" error={fields.serialNumber}>
                <input
                  id="asset-serial"
                  type="text"
                  value={form.serialNumber}
                  onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                  placeholder="Optional"
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="Location" htmlFor="asset-location" error={fields.location}>
                <input
                  id="asset-location"
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Optional - e.g. Bay 3"
                />
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

            <datalist id="asset-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
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
