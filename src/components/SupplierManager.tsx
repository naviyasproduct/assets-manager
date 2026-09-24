'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupplierKind } from '@prisma/client';
import { api, uploadImage } from '@/lib/client';
import { SUPPLIER_KIND_LABELS } from '@/lib/format';
import { Field, Alert, Modal, ConfirmDialog, EmptyState } from '@/components/ui';

export type SupplierRow = {
  id: string;
  name: string;
  kind: SupplierKind;
  contactPerson: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  isActive: boolean;
  orderCount: number;
  photoUrl: string | null;
};

const TEXT_FIELDS = [
  'name',
  'contactPerson',
  'phone',
  'altPhone',
  'email',
  'website',
  'address',
  'city',
  'country',
  'notes',
] as const;

type FormState = Record<(typeof TEXT_FIELDS)[number], string> & { kind: SupplierKind };

function blankForm(kind: SupplierKind): FormState {
  return {
    name: '',
    kind,
    contactPerson: '',
    phone: '',
    altPhone: '',
    email: '',
    website: '',
    address: '',
    city: '',
    country: '',
    notes: '',
  };
}

/** How the card writes a place: "Colombo, Sri Lanka", skipping whatever is blank. */
export function placeLine(supplier: Pick<SupplierRow, 'city' | 'country'>): string {
  return [supplier.city, supplier.country].filter(Boolean).join(', ');
}

export function SupplierManager({
  suppliers,
  canEdit,
}: {
  suppliers: SupplierRow[];
  canEdit: boolean;
}) {
  const router = useRouter();

  const [tab, setTab] = useState<SupplierKind>('LOCAL');
  const [query, setQuery] = useState('');
  const [showRetired, setShowRetired] = useState(false);

  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm('LOCAL'));
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const [deleting, setDeleting] = useState<SupplierRow | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [canDeactivate, setCanDeactivate] = useState(false);

  const counts = useMemo(
    () => ({
      LOCAL: suppliers.filter((s) => s.kind === 'LOCAL' && s.isActive).length,
      INTERNATIONAL: suppliers.filter((s) => s.kind === 'INTERNATIONAL' && s.isActive).length,
    }),
    [suppliers],
  );

  const retiredInTab = suppliers.filter((s) => s.kind === tab && !s.isActive).length;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return suppliers.filter((supplier) => {
      if (supplier.kind !== tab) return false;
      if (!supplier.isActive && !showRetired) return false;
      if (!needle) return true;
      return [
        supplier.name,
        supplier.contactPerson,
        supplier.phone,
        supplier.altPhone,
        supplier.email,
        supplier.city,
        supplier.country,
        supplier.address,
        supplier.notes,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [suppliers, tab, query, showRetired]);

  function choosePhoto(file: File | null) {
    setPhotoFile(file);
    setRemovePhoto(false);
    setPhotoPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function resetFormState() {
    setError('');
    setFields({});
    choosePhoto(null);
  }

  function openCreate() {
    // A new international supplier is added from the International tab, so
    // start it there rather than make someone flip the switch.
    setForm(blankForm(tab));
    resetFormState();
    setCreating(true);
  }

  function openEdit(supplier: SupplierRow) {
    const next = blankForm(supplier.kind);
    for (const key of TEXT_FIELDS) next[key] = supplier[key] ?? '';
    setForm(next);
    resetFormState();
    setEditing(supplier);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    resetFormState();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const result = editing
      ? await api<{ supplier: { id: string } }>(`/api/suppliers/${editing.id}`, {
          method: 'PATCH',
          json: form,
        })
      : await api<{ supplier: { id: string } }>('/api/suppliers', { method: 'POST', json: form });

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    const id = result.data.supplier.id;
    if (photoFile) {
      const uploaded = await uploadImage(`/api/suppliers/${id}/photo`, photoFile);
      if (!uploaded.ok) {
        setBusy(false);
        setError(`${uploaded.error} The details were saved without the photo.`);
        router.refresh();
        return;
      }
    } else if (removePhoto && editing?.photoUrl) {
      await api(`/api/suppliers/${id}/photo`, { method: 'DELETE' });
    }

    setBusy(false);
    // Land on the tab the supplier now lives in, so it is on screen.
    setTab(form.kind);
    closeForm();
    router.refresh();
  }

  async function reactivate(supplier: SupplierRow) {
    setBusy(true);
    await api(`/api/suppliers/${supplier.id}`, { method: 'PATCH', json: { isActive: true } });
    setBusy(false);
    router.refresh();
  }

  async function confirmDelete(mode: 'delete' | 'deactivate') {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');

    const result = await api(
      `/api/suppliers/${deleting.id}${mode === 'deactivate' ? '?mode=deactivate' : ''}`,
      { method: 'DELETE' },
    );
    setBusy(false);

    if (!result.ok) {
      setDeleteError(result.error);
      setCanDeactivate(Boolean(result.fields?.canDeactivate));
      return;
    }

    setDeleting(null);
    router.refresh();
  }

  const shownPhoto = photoPreview ?? (removePhoto ? null : (editing?.photoUrl ?? null));

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Supplier kind">
            {(['LOCAL', 'INTERNATIONAL'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={tab === kind}
                className={tab === kind ? 'is-on' : undefined}
                onClick={() => setTab(kind)}
              >
                {SUPPLIER_KIND_LABELS[kind]}
                <span className="tab-count">{counts[kind]}</span>
              </button>
            ))}
          </div>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, person, phone, city…"
            aria-label="Search suppliers"
            style={{ maxWidth: 300 }}
          />

          {retiredInTab > 0 ? (
            <label className="checkbox" style={{ fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
              />
              Show {retiredInTab} retired
            </label>
          ) : null}

          <div className="toolbar-spacer" />

          {canEdit ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
              Add {tab === 'LOCAL' ? 'local' : 'international'} supplier
            </button>
          ) : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            title={query ? 'No matches' : `No ${tab === 'LOCAL' ? 'local' : 'international'} suppliers yet`}
            message={
              query
                ? 'No supplier in this tab matches that search.'
                : 'Save the shops and firms you buy from, once, and every order can carry their address and numbers.'
            }
            action={
              canEdit && !query ? (
                <button type="button" className="btn btn-primary" onClick={openCreate}>
                  Add the first one
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="supplier-grid">
          {visible.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              actions={
                canEdit ? (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openEdit(supplier)}
                    >
                      Edit
                    </button>
                    {supplier.isActive ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          setDeleteError('');
                          setCanDeactivate(false);
                          setDeleting(supplier);
                        }}
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => reactivate(supplier)}
                        disabled={busy}
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                ) : null
              }
            />
          ))}
        </div>
      )}

      {creating || editing ? (
        <Modal
          wide
          title={editing ? `Edit ${editing.name}` : 'Add supplier'}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="supplier-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add supplier'}
              </button>
            </>
          }
        >
          <form id="supplier-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}

            <div className="person-form-head">
              <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
                {shownPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="supplier-logo supplier-logo-lg" src={shownPhoto} alt="" />
                ) : (
                  <div className="supplier-logo supplier-logo-lg supplier-logo-empty" aria-hidden="true">
                    {form.name.trim()[0]?.toUpperCase() ?? '?'}
                  </div>
                )}
                <label className="btn btn-secondary btn-sm">
                  {shownPhoto ? 'Change logo' : 'Add logo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
                {shownPhoto ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      choosePhoto(null);
                      setRemovePhoto(true);
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="field-row">
                  <Field label="Name" htmlFor="sup-name" error={fields.name}>
                    <input
                      id="sup-name"
                      type="text"
                      value={form.name}
                      autoFocus
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Where" htmlFor="sup-kind">
                    <div className="switch" role="radiogroup" aria-label="Local or international" style={{ height: 36 }}>
                      {(['LOCAL', 'INTERNATIONAL'] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          role="radio"
                          aria-checked={form.kind === kind}
                          className={form.kind === kind ? 'is-on' : undefined}
                          onClick={() => setForm({ ...form, kind })}
                        >
                          {SUPPLIER_KIND_LABELS[kind]}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
                <Field label="Contact person" htmlFor="sup-contact" error={fields.contactPerson}>
                  <input
                    id="sup-contact"
                    type="text"
                    value={form.contactPerson}
                    onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            <div className="field-row">
              <Field label="Phone" htmlFor="sup-phone" error={fields.phone}>
                <input
                  id="sup-phone"
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Other phone" htmlFor="sup-alt" error={fields.altPhone}>
                <input
                  id="sup-alt"
                  type="text"
                  value={form.altPhone}
                  onChange={(e) => setForm({ ...form, altPhone: e.target.value })}
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="Email" htmlFor="sup-email" error={fields.email}>
                <input
                  id="sup-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label="Website" htmlFor="sup-web" error={fields.website}>
                <input
                  id="sup-web"
                  type="text"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </Field>
            </div>

            <Field
              label="Address"
              htmlFor="sup-address"
              error={fields.address}
              hint="Printed on the order, so the buyer can find the place."
            >
              <textarea
                id="sup-address"
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>

            <div className="field-row">
              <Field label="City" htmlFor="sup-city" error={fields.city}>
                <input
                  id="sup-city"
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
              <Field label="Country" htmlFor="sup-country" error={fields.country}>
                <input
                  id="sup-country"
                  type="text"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </Field>
            </div>

            <Field
              label="Notes"
              htmlFor="sup-notes"
              error={fields.notes}
              hint="What they sell, opening hours, account number - whatever the buyer should know."
            >
              <textarea
                id="sup-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={canDeactivate ? `Deactivate ${deleting.name}?` : `Remove ${deleting.name}?`}
          confirmLabel={canDeactivate ? 'Deactivate' : 'Remove'}
          busy={busy}
          error={canDeactivate ? undefined : deleteError}
          message={
            canDeactivate ? (
              <>
                {deleteError} It will stop being offered for new orders and can be reactivated at
                any time.
              </>
            ) : (
              <>This removes the supplier and their details for good.</>
            )
          }
          onCancel={() => setDeleting(null)}
          onConfirm={() => confirmDelete(canDeactivate ? 'deactivate' : 'delete')}
        />
      ) : null}
    </>
  );
}

/**
 * One supplier's details as a card. Shared with the order screen, where the
 * same card tells whoever is buying where to go and whom to call.
 */
export function SupplierCard({
  supplier,
  actions,
  compact = false,
}: {
  supplier: Omit<SupplierRow, 'orderCount' | 'isActive'> &
    Partial<Pick<SupplierRow, 'orderCount' | 'isActive'>>;
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  const place = placeLine(supplier);
  return (
    <div className={`supplier-card${supplier.isActive === false ? ' is-retired' : ''}${compact ? ' is-compact' : ''}`}>
      <div className="supplier-head">
        {supplier.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="supplier-logo" src={supplier.photoUrl} alt="" />
        ) : (
          <div className="supplier-logo supplier-logo-empty" aria-hidden="true">
            {supplier.name.trim()[0]?.toUpperCase() ?? '?'}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="supplier-name">{supplier.name}</div>
          <div className="cell-sub">
            {[supplier.contactPerson, place].filter(Boolean).join(' · ') ||
              SUPPLIER_KIND_LABELS[supplier.kind]}
          </div>
        </div>
        {supplier.isActive === false ? <span className="pill pill-neutral">Retired</span> : null}
      </div>

      <dl className="supplier-facts">
        {supplier.phone ? (
          <>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${supplier.phone}`}>{supplier.phone}</a>
              {supplier.altPhone ? (
                <>
                  {' · '}
                  <a href={`tel:${supplier.altPhone}`}>{supplier.altPhone}</a>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        {supplier.email ? (
          <>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${supplier.email}`}>{supplier.email}</a>
            </dd>
          </>
        ) : null}
        {supplier.address ? (
          <>
            <dt>Address</dt>
            <dd style={{ whiteSpace: 'pre-line' }}>{supplier.address}</dd>
          </>
        ) : null}
        {supplier.website && !compact ? (
          <>
            <dt>Web</dt>
            <dd>{supplier.website}</dd>
          </>
        ) : null}
      </dl>

      {supplier.notes && !compact ? <p className="supplier-notes">{supplier.notes}</p> : null}

      {actions || supplier.orderCount !== undefined ? (
        <div className="supplier-foot">
          {supplier.orderCount !== undefined ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {supplier.orderCount === 0
                ? 'Not on any order yet'
                : `On ${supplier.orderCount} order${supplier.orderCount === 1 ? '' : 's'}`}
            </span>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
