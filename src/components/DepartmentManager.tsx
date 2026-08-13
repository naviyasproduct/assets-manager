'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Field, Alert, Modal, ConfirmDialog, EmptyState } from '@/components/ui';

export type DepartmentRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  location: string | null;
  isActive: boolean;
  assetCount: number;
  requestCount: number;
  userCount: number;
};

type FormState = {
  name: string;
  code: string;
  description: string;
  location: string;
};

const blankForm: FormState = { name: '', code: '', description: '', location: '' };

export function DepartmentManager({ departments }: { departments: DepartmentRow[] }) {
  const router = useRouter();

  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [deleting, setDeleting] = useState<DepartmentRow | null>(null);
  const [deleteError, setDeleteError] = useState('');

  function openCreate() {
    setForm(blankForm);
    setError('');
    setFields({});
    setCreating(true);
  }

  function openEdit(department: DepartmentRow) {
    setForm({
      name: department.name,
      code: department.code,
      description: department.description ?? '',
      location: department.location ?? '',
    });
    setError('');
    setFields({});
    setEditing(department);
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
      ? await api(`/api/departments/${editing.id}`, { method: 'PATCH', json: form })
      : await api('/api/departments', { method: 'POST', json: form });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    closeForm();
    router.refresh();
  }

  async function confirmDelete(mode?: 'deactivate') {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');

    const result = await api(
      `/api/departments/${deleting.id}${mode ? `?mode=${mode}` : ''}`,
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

  const hasRecords = deleting ? deleting.assetCount > 0 || deleting.requestCount > 0 : false;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            {departments.length} department{departments.length === 1 ? '' : 's'}
          </h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            Add department
          </button>
        </div>

        {departments.length === 0 ? (
          <EmptyState
            title="No departments yet"
            message="Add the first department to start tracking assets."
            action={
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                Add department
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Location</th>
                  <th className="num">Assets</th>
                  <th className="num">Requests</th>
                  <th className="num">Users</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {departments.map((department) => (
                  <tr key={department.id}>
                    <td>
                      <Link href={`/departments/${department.id}`} style={{ fontWeight: 600 }}>
                        {department.name}
                      </Link>
                      <span className="pill pill-accent mono" style={{ marginLeft: 8 }}>
                        {department.code}
                      </span>
                      {!department.isActive ? (
                        <span className="pill pill-neutral" style={{ marginLeft: 6 }}>
                          Inactive
                        </span>
                      ) : null}
                      {department.description ? (
                        <div className="cell-sub">{department.description}</div>
                      ) : null}
                    </td>
                    <td>{department.location ?? <span className="muted">-</span>}</td>
                    <td className="num">{department.assetCount}</td>
                    <td className="num">{department.requestCount}</td>
                    <td className="num">{department.userCount}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEdit(department)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            setDeleteError('');
                            setDeleting(department);
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
          title={editing ? `Edit ${editing.name}` : 'Add department'}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
              <button
                type="submit"
                form="department-form"
                className="btn btn-primary"
                disabled={busy}
              >
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add department'}
              </button>
            </>
          }
        >
          <form id="department-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}

            <div className="field-row">
              <Field label="Name" htmlFor="dept-name" error={fields.name}>
                <input
                  id="dept-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoFocus
                  required
                />
              </Field>

              <Field
                label="Code"
                htmlFor="dept-code"
                error={fields.code}
                hint="Used to number assets, e.g. PRT → PRT-001."
              >
                <input
                  id="dept-code"
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  maxLength={10}
                  required
                />
              </Field>
            </div>

            <Field label="Location" htmlFor="dept-location" error={fields.location}>
              <input
                id="dept-location"
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Optional - e.g. Ground floor, west wing"
              />
            </Field>

            <Field label="Description" htmlFor="dept-description" error={fields.description}>
              <textarea
                id="dept-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional. Appears at the top of this department's report section."
              />
            </Field>
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Remove ${deleting.name}?`}
          confirmLabel={hasRecords ? 'Deactivate instead' : 'Remove department'}
          busy={busy}
          error={deleteError}
          message={
            hasRecords ? (
              <>
                This department still holds <strong>{deleting.assetCount} asset(s)</strong> and{' '}
                <strong>{deleting.requestCount} purchase request(s)</strong>. Deleting it would take
                that history with it.
                <br />
                <br />
                Deactivating keeps every record intact and hides the department from day-to-day
                use. Move its assets elsewhere first if you truly want it gone.
              </>
            ) : (
              <>
                This department has no assets or purchase requests, so it can be removed
                permanently. Any users assigned to it will be left without a department.
              </>
            )
          }
          onCancel={() => setDeleting(null)}
          onConfirm={() => confirmDelete(hasRecords ? 'deactivate' : undefined)}
        />
      ) : null}
    </>
  );
}
