'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, uploadImage } from '@/lib/client';
import { SUPPLIER_KIND_LABELS } from '@/lib/format';
import type { OrderDetail } from '@/lib/order-types';
import type { OrderFormOptions } from '@/lib/purchase-order';
import type { AssetCategoryOption } from '@/components/AssetManager';
import { AssetPicker } from '@/components/AssetPicker';
import { Avatar } from '@/components/EmployeeManager';
import { Alert, Field } from '@/components/ui';

/**
 * Writing up a purchase order - the whole list at once, not one item at a
 * time. Used for a new order and to change one that has not been completed.
 *
 * Nothing here asks for a price: nobody knows it until the thing is bought,
 * and a guessed figure in a system reads as a real one. Prices go in on the
 * order's own page once it is out being bought.
 */

type Row = {
  /** Stable React key; `id` only exists once the line has been saved. */
  key: string;
  id: string | null;
  name: string;
  details: string;
  quantity: string;
  categoryId: string;
  basedOnAssetId: string | null;
  supplierId: string;
  photoFile: File | null;
  photoPreview: string | null;
  /** What is already stored for the line - its own photo or its asset's. */
  savedPhotoUrl: string | null;
  hasOwnPhoto: boolean;
  removePhoto: boolean;
};

type SheetPhoto =
  | { key: string; kind: 'saved'; id: string; url: string; remove: boolean }
  | { key: string; kind: 'new'; file: File; url: string };

let counter = 0;
const nextKey = () => `r${++counter}`;

function blankRow(): Row {
  return {
    key: nextKey(),
    id: null,
    name: '',
    details: '',
    quantity: '1',
    categoryId: '',
    basedOnAssetId: null,
    supplierId: '',
    photoFile: null,
    photoPreview: null,
    savedPhotoUrl: null,
    hasOwnPhoto: false,
    removePhoto: false,
  };
}

/** First three letters/digits of the name - the same suggestion the asset form makes. */
function suggestCode(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
}

const NEW_CATEGORY = '__new__';

export function OrderEditor({
  options,
  order,
}: {
  options: OrderFormOptions;
  /** The order being changed, or null for a new one. */
  order: OrderDetail | null;
}) {
  const router = useRouter();

  const [departmentId, setDepartmentId] = useState(
    order?.departmentId ?? options.departments[0]?.id ?? '',
  );
  const [note, setNote] = useState(order?.note ?? '');
  const [supplierIds, setSupplierIds] = useState<string[]>(order?.suppliers.map((s) => s.id) ?? []);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(order?.assignees.map((a) => a.id) ?? []);

  const [rows, setRows] = useState<Row[]>(() =>
    order && order.items.length > 0
      ? order.items.map((item) => ({
          key: nextKey(),
          id: item.id,
          name: item.name,
          details: item.details ?? '',
          quantity: String(item.quantity),
          categoryId: item.categoryId ?? '',
          basedOnAssetId: item.basedOnAssetId,
          supplierId: item.supplierId ?? '',
          photoFile: null,
          photoPreview: null,
          savedPhotoUrl: item.photoUrl,
          hasOwnPhoto: item.hasOwnPhoto,
          removePhoto: false,
        }))
      : [blankRow()],
  );

  const [sheet, setSheet] = useState<SheetPhoto[]>(
    () =>
      order?.photos
        .filter((photo) => photo.kind === 'SHEET')
        .map((photo) => ({
          key: nextKey(),
          kind: 'saved' as const,
          id: photo.id,
          url: photo.url,
          remove: false,
        })) ?? [],
  );

  // A category made from inside the form is usable before the page refreshes.
  const [addedCategories, setAddedCategories] = useState<AssetCategoryOption[]>([]);
  const [newCategory, setNewCategory] = useState<{ rowKey: string; name: string; code: string } | null>(null);
  const [categoryError, setCategoryError] = useState('');

  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const sheetInput = useRef<HTMLInputElement>(null);

  // --- Options for the department chosen ------------------------------------

  const categories = useMemo(
    () =>
      [...options.categories, ...addedCategories].filter(
        (category) => category.departmentId === departmentId && category.isActive,
      ),
    [options.categories, addedCategories, departmentId],
  );

  const assets = useMemo(
    () => options.assets.filter((asset) => asset.departmentId === departmentId),
    [options.assets, departmentId],
  );

  const chosenSuppliers = supplierIds
    .map((id) => options.suppliers.find((s) => s.id === id))
    .filter(Boolean) as OrderFormOptions['suppliers'];
  const addableSuppliers = options.suppliers.filter(
    (s) => s.isActive && !supplierIds.includes(s.id),
  );
  const chosenPeople = assigneeIds
    .map((id) => options.employees.find((p) => p.id === id))
    .filter(Boolean) as OrderFormOptions['employees'];
  const addablePeople = options.employees.filter((p) => !assigneeIds.includes(p.id));

  // --- Row edits --------------------------------------------------------------

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((current) => {
      const row = current.find((r) => r.key === key);
      if (row?.photoPreview) URL.revokeObjectURL(row.photoPreview);
      const next = current.filter((r) => r.key !== key);
      return next.length > 0 ? next : [blankRow()];
    });
  }

  function chooseRowPhoto(key: string, file: File | null) {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        if (row.photoPreview) URL.revokeObjectURL(row.photoPreview);
        return {
          ...row,
          photoFile: file,
          photoPreview: file ? URL.createObjectURL(file) : null,
          removePhoto: false,
        };
      }),
    );
  }

  /** Categories belong to a department, and so do the assets lines are picked from. */
  function changeDepartment(next: string) {
    setDepartmentId(next);
    setRows((current) =>
      current.map((row) => ({
        ...row,
        categoryId: '',
        basedOnAssetId: null,
        // A photo that only came from the old department's asset goes with it.
        savedPhotoUrl: row.hasOwnPhoto ? row.savedPhotoUrl : null,
      })),
    );
    setNewCategory(null);
  }

  function removeSupplier(id: string) {
    setSupplierIds((current) => current.filter((s) => s !== id));
    // A line cannot say it comes from a supplier the order no longer names.
    setRows((current) =>
      current.map((row) => (row.supplierId === id ? { ...row, supplierId: '' } : row)),
    );
  }

  async function createCategory() {
    if (!newCategory) return;
    setCategoryError('');
    const result = await api<{ category: AssetCategoryOption }>('/api/asset-categories', {
      method: 'POST',
      json: { name: newCategory.name, code: newCategory.code, departmentId },
    });
    if (!result.ok) {
      setCategoryError(result.fields?.name ?? result.fields?.code ?? result.error);
      return;
    }
    setAddedCategories((current) => [...current, result.data.category]);
    patchRow(newCategory.rowKey, { categoryId: result.data.category.id });
    setNewCategory(null);
  }

  function addSheetFiles(files: FileList | null) {
    if (!files) return;
    const added: SheetPhoto[] = [...files].map((file) => ({
      key: nextKey(),
      kind: 'new',
      file,
      url: URL.createObjectURL(file),
    }));
    setSheet((current) => [...current, ...added]);
  }

  // --- Save -------------------------------------------------------------------

  async function save() {
    setBusy(true);
    setError('');
    setFields({});

    // A trailing blank line is the "add another" row nobody filled in, not an
    // item called nothing.
    const filled = rows.filter(
      (row, index) => row.name.trim() !== '' || index < rows.length - 1 || rows.length === 1,
    );

    const payload = {
      departmentId,
      note,
      supplierIds,
      assigneeIds,
      items: filled.map((row) => ({
        id: row.id,
        name: row.name,
        details: row.details,
        quantity: row.quantity,
        categoryId: row.categoryId || null,
        basedOnAssetId: row.basedOnAssetId,
        supplierId: row.supplierId || null,
      })),
    };

    const result = order
      ? await api<{ order: { id: string; itemIds: string[] | null } }>(
          `/api/purchase-orders/${order.id}`,
          { method: 'PATCH', json: payload },
        )
      : await api<{ order: { id: string; itemIds: string[] } }>('/api/purchase-orders', {
          method: 'POST',
          json: payload,
        });

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    const { id, itemIds } = result.data.order;
    const failures: string[] = [];

    // Photos go after the order exists - a new line has no id to hang one on
    // until now. A failed upload does not undo the order; it is reported.
    for (const [index, row] of filled.entries()) {
      const itemId = itemIds?.[index];
      if (!itemId) continue;
      if (row.photoFile) {
        const up = await uploadImage(`/api/purchase-orders/${id}/items/${itemId}/photo`, row.photoFile);
        if (!up.ok) failures.push(`${row.name}: ${up.error}`);
      } else if (row.removePhoto && row.hasOwnPhoto) {
        await api(`/api/purchase-orders/${id}/items/${itemId}/photo`, { method: 'DELETE' });
      }
    }

    for (const photo of sheet) {
      if (photo.kind === 'new') {
        const up = await uploadImage(`/api/purchase-orders/${id}/photos?kind=SHEET`, photo.file, 'POST');
        if (!up.ok) failures.push(`Order sheet: ${up.error}`);
      } else if (photo.remove) {
        await api(`/api/purchase-orders/${id}/photos/${photo.id}`, { method: 'DELETE' });
      }
    }

    if (failures.length > 0) {
      setBusy(false);
      setError(
        `The order was saved, but ${failures.length} photo${failures.length === 1 ? '' : 's'} did not upload: ${failures.join('; ')}`,
      );
      // Stay on the form with the order now existing, so trying again edits it.
      router.replace(`/purchasing/${id}/edit`);
      router.refresh();
      return;
    }

    router.push(`/purchasing/${id}`);
    router.refresh();
  }

  const shownSheet = sheet.filter((photo) => photo.kind === 'new' || !photo.remove);

  return (
    <div className="order-editor">
      {error ? <Alert>{error}</Alert> : null}
      {fields._form ? <Alert>{fields._form}</Alert> : null}

      <div className="card">
        <div className="card-head">
          <h2>{order ? order.number : 'New purchase order'}</h2>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {order ? 'Changes save over this order.' : 'It gets its number when you save.'}
          </span>
        </div>
        <div className="card-body">
          <div className="field-row">
            <Field label="Department" htmlFor="po-dept" error={fields.departmentId}>
              <select
                id="po-dept"
                value={departmentId}
                onChange={(e) => changeDepartment(e.target.value)}
              >
                {options.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Note"
              htmlFor="po-note"
              error={fields.note}
              hint="Anything the buyer should know - when it is needed by, who to ask for."
            >
              <textarea
                id="po-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>

          <div className="section-label">The written order</div>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
            A photo of the handwritten list or the hard copy this order came from.
          </p>
          <div className="photo-strip">
            {shownSheet.map((photo) => (
              <div key={photo.key} className="photo-strip-item">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="Order sheet" />
                <button
                  type="button"
                  className="photo-strip-remove"
                  aria-label="Remove this photo"
                  onClick={() =>
                    setSheet((current) =>
                      photo.kind === 'new'
                        ? current.filter((p) => p.key !== photo.key)
                        : current.map((p) =>
                            p.key === photo.key && p.kind === 'saved' ? { ...p, remove: true } : p,
                          ),
                    )
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="photo-strip-add"
              onClick={() => sheetInput.current?.click()}
            >
              + Add photo
            </button>
            <input
              ref={sheetInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(e) => {
                addSheetFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Items</h2>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Type to pick equipment already on record, or write in something new.
          </span>
        </div>
        {fields.items ? (
          <div style={{ padding: '12px 18px 0' }}>
            <Alert>{fields.items}</Alert>
          </div>
        ) : null}
        <div className="order-lines">
          {rows.map((row, index) => {
            const shownPhoto = row.photoPreview ?? (row.removePhoto ? null : row.savedPhotoUrl);
            const err = (field: string) => fields[`items.${index}.${field}`];
            return (
              <div key={row.key} className="order-line">
                <div className="order-line-no">{index + 1}</div>

                <label className="order-line-photo" title="Add a photo of this item">
                  {shownPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shownPhoto} alt="" />
                  ) : (
                    <span>+ Photo</span>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(e) => chooseRowPhoto(row.key, e.target.files?.[0] ?? null)}
                  />
                </label>

                <div className="order-line-main">
                  <div className="order-line-top">
                    <Field label="Item" htmlFor={`po-item-${row.key}`} error={err('name')}>
                      <AssetPicker
                        id={`po-item-${row.key}`}
                        value={row.name}
                        options={
                          row.categoryId
                            ? assets.filter((a) => a.categoryId === row.categoryId)
                            : assets
                        }
                        invalid={Boolean(err('name'))}
                        placeholder="What needs buying"
                        onChange={(text, picked) => {
                          const asset = picked
                            ? options.assets.find((a) => a.id === picked.id)
                            : undefined;
                          patchRow(
                            row.key,
                            asset
                              ? {
                                  name: asset.name,
                                  basedOnAssetId: asset.id,
                                  categoryId: asset.categoryId,
                                  savedPhotoUrl: row.hasOwnPhoto ? row.savedPhotoUrl : asset.photoUrl,
                                }
                              : {
                                  name: text,
                                  // Typing over a picked name makes it a new thing.
                                  basedOnAssetId: null,
                                  savedPhotoUrl: row.hasOwnPhoto ? row.savedPhotoUrl : null,
                                },
                          );
                        }}
                      />
                    </Field>
                    <Field label="Qty" htmlFor={`po-qty-${row.key}`} error={err('quantity')}>
                      <input
                        id={`po-qty-${row.key}`}
                        type="number"
                        min="1"
                        step="1"
                        value={row.quantity}
                        onChange={(e) => patchRow(row.key, { quantity: e.target.value })}
                      />
                    </Field>
                  </div>

                  <div className="order-line-meta">
                    <Field label="Category" htmlFor={`po-cat-${row.key}`} error={err('categoryId')}>
                      <select
                        id={`po-cat-${row.key}`}
                        value={row.categoryId}
                        onChange={(e) => {
                          if (e.target.value === NEW_CATEGORY) {
                            setCategoryError('');
                            setNewCategory({ rowKey: row.key, name: '', code: '' });
                            return;
                          }
                          patchRow(row.key, { categoryId: e.target.value });
                        }}
                      >
                        <option value="">No category</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                        <option value={NEW_CATEGORY}>+ New category…</option>
                      </select>
                    </Field>
                    <Field label="Bought from" htmlFor={`po-sup-${row.key}`} error={err('supplierId')}>
                      <select
                        id={`po-sup-${row.key}`}
                        value={row.supplierId}
                        disabled={chosenSuppliers.length === 0}
                        onChange={(e) => patchRow(row.key, { supplierId: e.target.value })}
                      >
                        <option value="">
                          {chosenSuppliers.length === 0 ? 'Add a supplier below' : 'Any supplier'}
                        </option>
                        {chosenSuppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Details" htmlFor={`po-det-${row.key}`} error={err('details')}>
                      <input
                        id={`po-det-${row.key}`}
                        type="text"
                        value={row.details}
                        placeholder="Size, model, colour…"
                        onChange={(e) => patchRow(row.key, { details: e.target.value })}
                      />
                    </Field>
                  </div>

                  {newCategory?.rowKey === row.key ? (
                    <div className="inline-panel">
                      <div className="inline-panel-head">New category</div>
                      {categoryError ? <Alert>{categoryError}</Alert> : null}
                      <div className="field-row">
                        <Field label="Name" htmlFor="po-newcat-name">
                          <input
                            id="po-newcat-name"
                            type="text"
                            autoFocus
                            value={newCategory.name}
                            onChange={(e) =>
                              setNewCategory({
                                ...newCategory,
                                name: e.target.value,
                                // Follow the name until someone types a code of their own.
                                code:
                                  newCategory.code === suggestCode(newCategory.name)
                                    ? suggestCode(e.target.value)
                                    : newCategory.code,
                              })
                            }
                          />
                        </Field>
                        <Field label="Code" htmlFor="po-newcat-code" hint="The middle of the asset tag, e.g. CHR.">
                          <input
                            id="po-newcat-code"
                            type="text"
                            value={newCategory.code}
                            onChange={(e) => setNewCategory({ ...newCategory, code: e.target.value.toUpperCase() })}
                          />
                        </Field>
                      </div>
                      <div className="row">
                        <button type="button" className="btn btn-primary btn-sm" onClick={createCategory}>
                          Create category
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewCategory(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {row.basedOnAssetId ? (
                    <div className="cell-sub">
                      Another one of{' '}
                      {options.assets.find((a) => a.id === row.basedOnAssetId)?.assetTag ?? 'an asset on record'}
                    </div>
                  ) : null}
                </div>

                <div className="order-line-actions">
                  {shownPhoto && (row.photoFile || row.hasOwnPhoto) ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        chooseRowPhoto(row.key, null);
                        patchRow(row.key, { removePhoto: true });
                      }}
                    >
                      Remove photo
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() => removeRow(row.key)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setRows((current) => [...current, blankRow()])}
          >
            + Add item
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Suppliers</h2>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {fields.supplierIds ? <Alert>{fields.supplierIds}</Alert> : null}
            {chosenSuppliers.map((supplier) => (
              <div key={supplier.id} className="pick-row">
                {supplier.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="supplier-logo" style={{ width: 32, height: 32, flexBasis: 32 }} src={supplier.photoUrl} alt="" />
                ) : (
                  <div className="supplier-logo supplier-logo-empty" style={{ width: 32, height: 32, flexBasis: 32, fontSize: 13 }}>
                    {supplier.name[0]?.toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{supplier.name}</strong>
                  <div className="cell-sub">
                    {SUPPLIER_KIND_LABELS[supplier.kind]}
                    {supplier.phone ? ` · ${supplier.phone}` : ''}
                  </div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSupplier(supplier.id)}>
                  Remove
                </button>
              </div>
            ))}
            {addableSuppliers.length > 0 ? (
              <select
                aria-label="Add a supplier"
                value=""
                onChange={(e) => e.target.value && setSupplierIds((c) => [...c, e.target.value])}
              >
                <option value="">+ Add a supplier…</option>
                {(['LOCAL', 'INTERNATIONAL'] as const).map((kind) => {
                  const list = addableSuppliers.filter((s) => s.kind === kind);
                  return list.length > 0 ? (
                    <optgroup key={kind} label={SUPPLIER_KIND_LABELS[kind]}>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.city ? ` - ${s.city}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            ) : options.suppliers.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                No suppliers saved yet. <Link href="/suppliers">Add them on the Suppliers screen.</Link>
              </p>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Taken care of by</h2>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {fields.assigneeIds ? <Alert>{fields.assigneeIds}</Alert> : null}
            {chosenPeople.map((person) => (
              <div key={person.id} className="pick-row">
                <Avatar name={person.name} photoUrl={person.photoUrl} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{person.name}</strong>
                  <div className="cell-sub">
                    {[person.jobTitle, person.phone].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAssigneeIds((c) => c.filter((id) => id !== person.id))}
                >
                  Remove
                </button>
              </div>
            ))}
            {addablePeople.length > 0 ? (
              <select
                aria-label="Assign someone"
                value=""
                onChange={(e) => e.target.value && setAssigneeIds((c) => [...c, e.target.value])}
              >
                <option value="">+ Assign someone…</option>
                {addablePeople.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.jobTitle ? ` - ${person.jobTitle}` : ''}
                  </option>
                ))}
              </select>
            ) : null}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Whoever is assigned sees this order, can add photos of what was bought, enter what it
              cost and mark it completed.
            </p>
          </div>
        </div>
      </div>

      <div className="order-editor-foot">
        <Link href={order ? `/purchasing/${order.id}` : '/purchasing'} className="btn btn-secondary">
          Cancel
        </Link>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : order ? 'Save changes' : 'Save order'}
        </button>
      </div>
    </div>
  );
}
