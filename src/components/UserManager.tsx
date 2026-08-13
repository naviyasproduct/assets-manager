'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@prisma/client';
import { api } from '@/lib/client';
import { formatDateTime } from '@/lib/format';
import { Field, Alert, Modal, ConfirmDialog, EmptyState } from '@/components/ui';
import type { DepartmentOption } from '@/components/AssetManager';

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  departmentId: string | null;
  departmentName: string | null;
};

type FormState = {
  name: string;
  email: string;
  password: string;
  role: Role;
  departmentId: string;
};

function blankForm(departmentId: string): FormState {
  return { name: '', email: '', password: '', role: 'DEPT_HEAD', departmentId };
}

export function UserManager({
  users,
  departments,
  currentUserId,
}: {
  users: UserRow[];
  departments: DepartmentOption[];
  currentUserId: string;
}) {
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<FormState>(blankForm(departments[0]?.id ?? ''));
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [deactivating, setDeactivating] = useState<UserRow | null>(null);
  const [deactivateError, setDeactivateError] = useState('');

  function openCreate() {
    setForm(blankForm(departments[0]?.id ?? ''));
    setError('');
    setFields({});
    setCreating(true);
  }

  function openEdit(user: UserRow) {
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      departmentId: user.departmentId ?? departments[0]?.id ?? '',
    });
    setError('');
    setFields({});
    setEditing(user);
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
      ? await api(`/api/users/${editing.id}`, {
          method: 'PATCH',
          json: {
            name: form.name,
            email: form.email,
            role: form.role,
            departmentId: form.role === 'ADMIN' ? null : form.departmentId,
            // Only sent when the admin actually typed a new one.
            ...(form.password ? { newPassword: form.password } : {}),
          },
        })
      : await api('/api/users', {
          method: 'POST',
          json: {
            name: form.name,
            email: form.email,
            password: form.password,
            role: form.role,
            departmentId: form.role === 'ADMIN' ? null : form.departmentId,
          },
        });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    closeForm();
    router.refresh();
  }

  async function toggleActive(user: UserRow) {
    setBusy(true);
    await api(`/api/users/${user.id}`, {
      method: 'PATCH',
      json: { isActive: !user.isActive },
    });
    setBusy(false);
    router.refresh();
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    setBusy(true);
    setDeactivateError('');

    const result = await api(`/api/users/${deactivating.id}`, { method: 'DELETE' });
    setBusy(false);

    if (!result.ok) {
      setDeactivateError(result.error);
      return;
    }

    setDeactivating(null);
    router.refresh();
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            {users.length} account{users.length === 1 ? '' : 's'}
          </h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            Add user
          </button>
        </div>

        {users.length === 0 ? (
          <EmptyState title="No users" message="Add the first account." />
        ) : (
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Last signed in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} style={{ opacity: user.isActive ? 1 : 0.55 }}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{user.name}</span>
                      {user.id === currentUserId ? (
                        <span className="pill pill-accent" style={{ marginLeft: 8 }}>
                          You
                        </span>
                      ) : null}
                      {!user.isActive ? (
                        <span className="pill pill-neutral" style={{ marginLeft: 6 }}>
                          Deactivated
                        </span>
                      ) : null}
                      {user.mustChangePassword && user.isActive ? (
                        <div className="cell-sub">Temporary password not yet changed</div>
                      ) : null}
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className={`pill pill-${user.role === 'ADMIN' ? 'accent' : 'neutral'}`}>
                        {user.role === 'ADMIN' ? 'Admin' : 'Dept head'}
                      </span>
                    </td>
                    <td>{user.departmentName ?? <span className="muted">All</span>}</td>
                    <td className="nowrap">
                      {user.lastLoginAt ? (
                        formatDateTime(user.lastLoginAt)
                      ) : (
                        <span className="muted">Never</span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEdit(user)}
                        >
                          Edit
                        </button>
                        {user.id === currentUserId ? null : user.isActive ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              setDeactivateError('');
                              setDeactivating(user);
                            }}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => toggleActive(user)}
                            disabled={busy}
                          >
                            Reactivate
                          </button>
                        )}
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
          title={editing ? `Edit ${editing.name}` : 'Add user'}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
              </button>
            </>
          }
        >
          <form id="user-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}

            <Field label="Name" htmlFor="user-name" error={fields.name}>
              <input
                id="user-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
                required
              />
            </Field>

            <Field label="Email" htmlFor="user-email" error={fields.email}>
              <input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>

            <Field
              label={editing ? 'Reset password' : 'Temporary password'}
              htmlFor="user-password"
              error={fields.password ?? fields.newPassword}
              hint={
                editing
                  ? 'Leave blank to keep the current password. Setting one signs the user out everywhere.'
                  : 'At least 10 characters. The user must change it when they first sign in.'
              }
            >
              <input
                id="user-password"
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="off"
                required={!editing}
              />
            </Field>

            <div className="field-row">
              <Field label="Role" htmlFor="user-role" error={fields.role}>
                <select
                  id="user-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                >
                  <option value="DEPT_HEAD">Department head</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </Field>

              {form.role === 'DEPT_HEAD' ? (
                <Field label="Department" htmlFor="user-department" error={fields.departmentId}>
                  <select
                    id="user-department"
                    value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                    required
                  >
                    <option value="">Select…</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Department" htmlFor="user-department-none">
                  <input
                    id="user-department-none"
                    type="text"
                    value="All departments"
                    disabled
                    readOnly
                  />
                </Field>
              )}
            </div>
          </form>
        </Modal>
      ) : null}

      {deactivating ? (
        <ConfirmDialog
          title={`Deactivate ${deactivating.name}?`}
          confirmLabel="Deactivate"
          busy={busy}
          error={deactivateError}
          message={
            <>
              They will be signed out immediately and will not be able to sign back in. Their
              purchase requests and repair records stay intact, so history remains readable. You can
              reactivate the account at any time.
            </>
          }
          onCancel={() => setDeactivating(null)}
          onConfirm={confirmDeactivate}
        />
      ) : null}
    </>
  );
}
