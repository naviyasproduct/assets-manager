'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, uploadImage } from '@/lib/client';
import { SUPPLIER_KIND_LABELS } from '@/lib/format';
import { SIGN_OFF_ROLES, type OrderDetail } from '@/lib/order-types';
import type { OrderFormOptions } from '@/lib/purchase-order';
import type { AssetCategoryOption } from '@/components/AssetManager';
import { AssetPicker } from '@/components/AssetPicker';
import { Avatar } from '@/components/EmployeeManager';
import { Alert, Field } from '@/components/ui';
import { ORDER_DRAFT_PREFIX, clearDraft, stashDraft, takeDraft } from '@/lib/form-draft';

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
  codeNo: string;
  name: string;
  details: string;
  quantity: string;
  unitId: string;
  categoryId: string;
  basedOnAssetId: string | null;
  /** Set when the name was taken from the catalogue rather than typed fresh. */
  catalogueItemId: string | null;
  supplierId: string;
  receivedDate: string;
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

/**
 * What is put aside while this form is open, so a trip to another page or
 * window - Suppliers, the sidebar, anywhere - and back restores everything
 * typed rather than a blank order. Keyed per order (or "new"), because
 * editing two different orders in two tabs should not overwrite each other.
 * Files cannot survive sessionStorage, so a photo already chosen has to be
 * re-attached after restoring - the restored banner says so.
 */
type OrderDraft = {
  departmentId: string;
  kind: 'LOCAL' | 'OVERSEA';
  note: string;
  originFrom: string;
  attention: string;
  deliveryTerms: string;
  paymentTerms: string;
  signOff: { requestedById: string; issuedById: string; checkedById: string; authorizedById: string };
  supplierIds: string[];
  assigneeIds: string[];
  rows: Array<Omit<Row, 'key' | 'photoFile' | 'photoPreview'> & { hadNewPhoto: boolean }>;
  sheetRemovals: string[];
  hadNewSheetPhotos: boolean;
};

function blankRow(): Row {
  return {
    key: nextKey(),
    id: null,
    codeNo: '',
    name: '',
    details: '',
    quantity: '1',
    unitId: '',
    categoryId: '',
    basedOnAssetId: null,
    catalogueItemId: null,
    supplierId: '',
    receivedDate: '',
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
  const draftKey = `${ORDER_DRAFT_PREFIX}${order?.id ?? 'new'}`;
  const [restoredNote, setRestoredNote] = useState('');

  const [departmentId, setDepartmentId] = useState(
    order?.departmentId ?? options.departments[0]?.id ?? '',
  );
  const [kind, setKind] = useState<'LOCAL' | 'OVERSEA'>(order?.kind ?? 'LOCAL');
  const [note, setNote] = useState(order?.note ?? '');

  // Oversea only. Free text with a suggestion list behind each, so a new
  // shipper's wording can be typed without anyone opening a settings screen.
  const [originFrom, setOriginFrom] = useState(order?.originFrom ?? '');
  const [attention, setAttention] = useState(order?.attention ?? '');
  const [deliveryTerms, setDeliveryTerms] = useState(order?.deliveryTerms ?? '');
  const [paymentTerms, setPaymentTerms] = useState(order?.paymentTerms ?? '');

  const [signOff, setSignOff] = useState({
    requestedById: order?.requestedBy?.id ?? '',
    issuedById: order?.issuedBy?.id ?? '',
    checkedById: order?.checkedBy?.id ?? '',
    authorizedById: order?.authorizedBy?.id ?? '',
  });
  const [supplierIds, setSupplierIds] = useState<string[]>(order?.suppliers.map((s) => s.id) ?? []);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(order?.assignees.map((a) => a.id) ?? []);

  const [rows, setRows] = useState<Row[]>(() =>
    order && order.items.length > 0
      ? order.items.map((item) => ({
          key: nextKey(),
          id: item.id,
          codeNo: item.codeNo ?? '',
          name: item.name,
          details: item.details ?? '',
          quantity: String(item.quantity),
          unitId: item.unitId ?? '',
          categoryId: item.categoryId ?? '',
          basedOnAssetId: item.basedOnAssetId,
          catalogueItemId: item.catalogueItemId,
          supplierId: item.supplierId ?? '',
          receivedDate: item.receivedDate ? item.receivedDate.slice(0, 10) : '',
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

  /**
   * Picks up a draft left by an earlier visit to this same order (or, for a
   * new order, the last unsaved "new order" draft in this tab). Runs once, on
   * the way back from wherever the form was left.
   */
  useEffect(() => {
    const draft = takeDraft<OrderDraft>(draftKey);
    if (!draft) return;

    setDepartmentId(draft.departmentId);
    setKind(draft.kind);
    setNote(draft.note);
    setOriginFrom(draft.originFrom);
    setAttention(draft.attention);
    setDeliveryTerms(draft.deliveryTerms);
    setPaymentTerms(draft.paymentTerms);
    setSignOff(draft.signOff);
    setSupplierIds(draft.supplierIds);
    setAssigneeIds(draft.assigneeIds);
    setRows(
      draft.rows.length > 0
        ? draft.rows.map(({ hadNewPhoto: _hadNewPhoto, ...row }) => ({
            ...row,
            key: nextKey(),
            photoFile: null,
            photoPreview: null,
          }))
        : [blankRow()],
    );
    setSheet((current) =>
      current.map((photo) =>
        photo.kind === 'saved' && draft.sheetRemovals.includes(photo.id)
          ? { ...photo, remove: true }
          : photo,
      ),
    );

    const lostPhotos =
      draft.rows.some((row) => row.hadNewPhoto) || draft.hadNewSheetPhotos;
    setRestoredNote(
      lostPhotos
        ? 'Your entries were kept. Choose any newly-added photos again before saving.'
        : 'Your entries were kept.',
    );
    // Runs once, on mount - restoring again on every re-render would fight typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Autosaves the whole form on every change, so leaving this page - by any route - and coming back restores it. */
  useEffect(() => {
    const draft: OrderDraft = {
      departmentId,
      kind,
      note,
      originFrom,
      attention,
      deliveryTerms,
      paymentTerms,
      signOff,
      supplierIds,
      assigneeIds,
      rows: rows.map(({ key: _key, photoFile, photoPreview: _photoPreview, ...row }) => ({
        ...row,
        hadNewPhoto: photoFile !== null,
      })),
      sheetRemovals: sheet
        .filter((p): p is Extract<SheetPhoto, { kind: 'saved' }> => p.kind === 'saved' && p.remove)
        .map((p) => p.id),
      hadNewSheetPhotos: sheet.some((p) => p.kind === 'new'),
    };
    stashDraft(draftKey, draft);
  }, [
    draftKey,
    departmentId,
    kind,
    note,
    originFrom,
    attention,
    deliveryTerms,
    paymentTerms,
    signOff,
    supplierIds,
    assigneeIds,
    rows,
    sheet,
  ]);

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
      kind,
      note,
      // The server drops these on a local order anyway; sending them blank
      // keeps the two forms from disagreeing about what was cleared.
      originFrom: kind === 'OVERSEA' ? originFrom : '',
      attention: kind === 'OVERSEA' ? attention : '',
      deliveryTerms: kind === 'OVERSEA' ? deliveryTerms : '',
      paymentTerms: kind === 'OVERSEA' ? paymentTerms : '',
      requestedById: signOff.requestedById || null,
      issuedById: signOff.issuedById || null,
      checkedById: signOff.checkedById || null,
      authorizedById: signOff.authorizedById || null,
      supplierIds,
      assigneeIds,
      items: filled.map((row) => ({
        id: row.id,
        codeNo: row.codeNo,
        name: row.name,
        details: row.details,
        quantity: row.quantity,
        unitId: row.unitId || null,
        categoryId: row.categoryId || null,
        basedOnAssetId: row.basedOnAssetId,
        catalogueItemId: row.catalogueItemId,
        supplierId: row.supplierId || null,
        receivedDate: row.receivedDate,
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

    // The order itself is saved from here on - only photo uploads can still
    // fail below - so the draft has done its job.
    clearDraft(draftKey);

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
      {restoredNote ? <Alert kind="info">{restoredNote}</Alert> : null}
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
              label="Bought"
              htmlFor="po-kind"
              error={fields.kind}
              hint={
                kind === 'OVERSEA'
                  ? 'Shipped in - the terms below print on the order.'
                  : 'From a supplier in the region.'
              }
            >
              <select
                id="po-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'LOCAL' | 'OVERSEA')}
              >
                <option value="LOCAL">Locally</option>
                <option value="OVERSEA">Oversea</option>
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

          {kind === 'OVERSEA' ? (
            <>
              <div className="section-label">Terms</div>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
                What was agreed with the shipper. Each box remembers what has been
                typed before - pick one, or type something new.
              </p>
              <div className="field-row">
                <Field label="From" htmlFor="po-from" error={fields.originFrom}>
                  <input
                    id="po-from"
                    type="text"
                    list="po-list-from"
                    value={originFrom}
                    onChange={(e) => setOriginFrom(e.target.value)}
                  />
                </Field>
                <Field label="Attention" htmlFor="po-attention" error={fields.attention}>
                  <input
                    id="po-attention"
                    type="text"
                    list="po-list-attention"
                    value={attention}
                    onChange={(e) => setAttention(e.target.value)}
                  />
                </Field>
              </div>
              <div className="field-row">
                <Field label="Delivery" htmlFor="po-delivery" error={fields.deliveryTerms}>
                  <input
                    id="po-delivery"
                    type="text"
                    list="po-list-delivery"
                    value={deliveryTerms}
                    onChange={(e) => setDeliveryTerms(e.target.value)}
                  />
                </Field>
                <Field label="Payment" htmlFor="po-payment" error={fields.paymentTerms}>
                  <input
                    id="po-payment"
                    type="text"
                    list="po-list-payment"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                  />
                </Field>
              </div>
              <datalist id="po-list-from">
                {options.listOptions.FROM.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <datalist id="po-list-attention">
                {options.listOptions.ATTENTION.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <datalist id="po-list-delivery">
                {options.listOptions.DELIVERY.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <datalist id="po-list-payment">
                {options.listOptions.PAYMENT.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </>
          ) : null}

          <div className="section-label">Signed off by</div>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
            The four boxes at the foot of the order. Leave any blank to sign it by
            hand instead.
          </p>
          <div className="field-row">
            {SIGN_OFF_ROLES.map((role) => (
              <Field key={role.key} label={role.label} htmlFor={`po-${role.key}`}>
                <select
                  id={`po-${role.key}`}
                  value={signOff[`${role.key}Id` as keyof typeof signOff]}
                  onChange={(e) =>
                    setSignOff((current) => ({ ...current, [`${role.key}Id`]: e.target.value }))
                  }
                >
                  <option value="">Nobody</option>
                  {options.signatories.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
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
                        catalogue={options.catalogue}
                        invalid={Boolean(err('name'))}
                        placeholder="What needs buying"
                        onChange={(text, picked, entry) => {
                          const asset = picked
                            ? options.assets.find((a) => a.id === picked.id)
                            : undefined;
                          if (asset) {
                            patchRow(row.key, {
                              name: asset.name,
                              basedOnAssetId: asset.id,
                              catalogueItemId: null,
                              categoryId: asset.categoryId,
                              savedPhotoUrl: row.hasOwnPhoto ? row.savedPhotoUrl : asset.photoUrl,
                            });
                            return;
                          }
                          patchRow(row.key, {
                            name: entry ? entry.name : text,
                            // Typing over a picked name makes it a new thing.
                            basedOnAssetId: null,
                            catalogueItemId: entry ? entry.id : null,
                            // One description on record is almost always the
                            // one meant; more than one is a choice to make.
                            details:
                              entry && entry.descriptions.length === 1 && row.details === ''
                                ? entry.descriptions[0]
                                : row.details,
                            savedPhotoUrl: row.hasOwnPhoto ? row.savedPhotoUrl : null,
                          });
                        }}
                      />
                    </Field>
                    <Field label="Qty" htmlFor={`po-qty-${row.key}`} error={err('quantity')}>
                      <input
                        id={`po-qty-${row.key}`}
                        type="number"
                        min="0"
                        step="any"
                        value={row.quantity}
                        onChange={(e) => patchRow(row.key, { quantity: e.target.value })}
                      />
                    </Field>
                    <Field label="Unit" htmlFor={`po-unit-${row.key}`} error={err('unitId')}>
                      <select
                        id={`po-unit-${row.key}`}
                        value={row.unitId}
                        onChange={(e) => patchRow(row.key, { unitId: e.target.value })}
                      >
                        <option value="">No unit</option>
                        {options.units.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name}
                          </option>
                        ))}
                      </select>
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
                        list={row.catalogueItemId ? `po-desc-${row.key}` : undefined}
                        value={row.details}
                        placeholder="Size, model, colour…"
                        onChange={(e) => patchRow(row.key, { details: e.target.value })}
                      />
                      {row.catalogueItemId ? (
                        <datalist id={`po-desc-${row.key}`}>
                          {(
                            options.catalogue.find((entry) => entry.id === row.catalogueItemId)
                              ?.descriptions ?? []
                          ).map((text) => (
                            <option key={text} value={text} />
                          ))}
                        </datalist>
                      ) : null}
                    </Field>
                    <Field
                      label="Code"
                      htmlFor={`po-code-${row.key}`}
                      error={err('codeNo')}
                      hint="Only if the paperwork quotes one."
                    >
                      <input
                        id={`po-code-${row.key}`}
                        type="text"
                        value={row.codeNo}
                        onChange={(e) => patchRow(row.key, { codeNo: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Arrived"
                      htmlFor={`po-got-${row.key}`}
                      error={err('receivedDate')}
                      hint="When this line turned up, if it already has."
                    >
                      <input
                        id={`po-got-${row.key}`}
                        type="date"
                        value={row.receivedDate}
                        onChange={(e) => patchRow(row.key, { receivedDate: e.target.value })}
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
        <Link
          href={order ? `/purchasing/${order.id}` : '/purchasing'}
          className="btn btn-secondary"
          onClick={() => clearDraft(draftKey)}
        >
          Cancel
        </Link>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : order ? 'Save changes' : 'Save order'}
        </button>
      </div>
    </div>
  );
}
