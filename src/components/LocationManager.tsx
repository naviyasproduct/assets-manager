'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Field, Alert, Modal, ConfirmDialog, EmptyState } from '@/components/ui';

export type LocationRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  assetCount: number;
  /** Which departments have equipment standing here, most assets first. */
  departments: Array<{ id: string; name: string; assetCount: number }>;
};

type FormState = { name: string; description: string };

const blankForm: FormState = { name: '', description: '' };

export function LocationManager({ locations }: { locations: LocationRow[] }) {
  const router = useRouter();

  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [deleting, setDeleting] = useState<LocationRow | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const totalAssets = useMemo(
    () => locations.reduce((sum, location) => sum + location.assetCount, 0),
    [locations],
  );

  function openCreate() {
    setForm(blankForm);
    setError('');
    setFields({});
    setCreating(true);
  }

  function openEdit(location: LocationRow) {
    setForm({ name: location.name, description: location.description ?? '' });
    setError('');
    setFields({});
    setEditing(location);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const result = editing
      ? await api(`/api/locations/${editing.id}`, { method: 'PATCH', json: form })
      : await api('/api/locations', { method: 'POST', json: form });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    closeForm();
    router.refresh();
  }

  async function setActive(location: LocationRow, isActive: boolean) {
    setBusy(true);
    const result = await api(`/api/locations/${location.id}`, {
      method: 'PATCH',
      json: { isActive },
    });
    setBusy(false);

    if (result.ok) router.refresh();
  }

  async function confirmDelete(mode?: 'deactivate') {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');

    const result = await api(
      `/api/locations/${deleting.id}${mode ? `?mode=${mode}` : ''}`,
      { method: 'DELETE' },
    );

    setBusy(false);

    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }

    setDeleting(null);
    router.refresh();
  }

  const hasAssets = deleting ? deleting.assetCount > 0 : false;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            {locations.length} location{locations.length === 1 ? '' : 's'}
            {totalAssets > 0 ? (
              <span className="muted" style={{ fontWeight: 400 }}>
                {' '}
                · {totalAssets} asset{totalAssets === 1 ? '' : 's'} placed
              </span>
            ) : null}
          </h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            Add location
          </button>
        </div>

        {locations.length === 0 ? (
          <EmptyState
            title="No locations yet"
            message="Add the places equipment actually stands - a bay, a shed, a floor - and assets can then be filed against them."
            action={
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                Add the first location
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>What is stored here</th>
                  <th className="num">Assets</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr key={location.id}>
                    <td>
                      {location.assetCount > 0 ? (
                        <Link
                          href={`/assets?locationId=${location.id}`}
                          style={{ fontWeight: 600 }}
                        >
                          {location.name}
                        </Link>
                      ) : (
                        <span style={{ fontWeight: 600 }}>{location.name}</span>
                      )}
                      {!location.isActive ? (
                        <span className="pill pill-neutral" style={{ marginLeft: 6 }}>
                          Inactive
                        </span>
                      ) : null}
                      {location.description ? (
                        <div className="cell-sub">{location.description}</div>
                      ) : null}
                    </td>
                    <td>
                      {/* The whole reason locations are site-wide rather than
                          owned by a department: one place, several departments'
                          equipment standing in it. */}
                      {location.departments.length === 0 ? (
                        <span className="muted">Nothing yet</span>
                      ) : (
                        <div className="cell-sub" style={{ marginTop: 0 }}>
                          {location.departments
                            .map((d) => `${d.name} ${d.assetCount}`)
                            .join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="num">{location.assetCount}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEdit(location)}
                        >
                          Edit
                        </button>
                        {location.isActive ? null : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setActive(location, true)}
                            disabled={busy}
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            setDeleteError('');
                            setDeleting(location);
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
          title={editing ? `Edit ${editing.name}` : 'Add location'}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="location-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add location'}
              </button>
            </>
          }
        >
          <form id="location-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}

            <Field
              label="Name"
              htmlFor="location-name"
              error={fields.name}
              hint="What people on the floor call it, e.g. Shed B, Line 2 - East, Server cupboard."
            >
              <input
                id="location-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
                required
              />
            </Field>

            <Field label="Description" htmlFor="location-description" error={fields.description}>
              <textarea
                id="location-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional. Anything that helps someone find it - which building, which end."
              />
            </Field>

            {editing && editing.assetCount > 0 ? (
              <Alert kind="info">
                {editing.assetCount} asset(s) point at this location. Renaming it updates every one
                of them.
              </Alert>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Remove ${deleting.name}?`}
          confirmLabel={hasAssets ? 'Deactivate instead' : 'Remove location'}
          busy={busy}
          error={deleteError}
          message={
            hasAssets ? (
              <>
                <strong>{deleting.assetCount} asset(s)</strong> are recorded as standing here, so
                this location cannot be deleted without leaving them with nowhere.
                <br />
                <br />
                Deactivating keeps every record and only stops the location being offered for new
                assets - which is what a bay that is no longer in use usually means while machines
                are still sitting in it.
              </>
            ) : (
              <>
                Nothing is stored here, so this location can be removed permanently. This cannot be
                undone.
              </>
            )
          }
          onCancel={() => setDeleting(null)}
          onConfirm={() => confirmDelete(hasAssets ? 'deactivate' : undefined)}
        />
      ) : null}
    </>
  );
}
