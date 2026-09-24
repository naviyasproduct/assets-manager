'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@prisma/client';
import { api, uploadImage } from '@/lib/client';
import { formatDateTime } from '@/lib/format';
import {
  AREAS,
  AREA_INFO,
  LEVEL_LABELS,
  ROLE_LABELS,
  ROLE_TEMPLATES,
  resolveAccess,
  type Access,
  type Area,
} from '@/lib/permissions';
import { Field, Alert, Modal, ConfirmDialog, EmptyState } from '@/components/ui';

export type EmployeeRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  jobTitle: string | null;
  phone: string | null;
  allDepartments: boolean;
  departmentId: string | null;
  departmentName: string | null;
  photoUrl: string | null;
  /** Account details - only sent to an administrator. */
  account: {
    mustChangePassword: boolean;
    lastLoginAt: string | null;
    access: Access;
  } | null;
};

type FormState = {
  name: string;
  jobTitle: string;
  phone: string;
  email: string;
  password: string;
  role: Role;
  /** 'ALL', or a department id. */
  scope: string;
  access: Access;
};

const ROLE_ORDER: Role[] = ['EMPLOYEE', 'DEPT_HEAD', 'ADMIN'];

function blankForm(): FormState {
  return {
    name: '',
    jobTitle: '',
    phone: '',
    email: '',
    password: '',
    role: 'EMPLOYEE',
    scope: 'ALL',
    access: { ...ROLE_TEMPLATES.EMPLOYEE },
  };
}

/** How many areas differ from the role's template - "custom" in the table. */
function customCount(role: Role, access: Access): number {
  if (role === 'ADMIN') return 0;
  return AREAS.filter((area) => access[area] !== ROLE_TEMPLATES[role][area]).length;
}

export function Avatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name: string;
  photoUrl: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';

  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`avatar avatar-${size}`} src={photoUrl} alt="" />
  ) : (
    <span className={`avatar avatar-${size} avatar-empty`} aria-hidden="true">
      {initials}
    </span>
  );
}

export function EmployeeManager({
  employees,
  departments,
  currentUserId,
  isAdmin,
}: {
  employees: EmployeeRow[];
  departments: Array<{ id: string; name: string }>;
  currentUserId: string;
  /** Manages accounts. Anyone else gets the directory: faces, titles, numbers. */
  isAdmin: boolean;
}) {
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const [deactivating, setDeactivating] = useState<EmployeeRow | null>(null);
  const [deactivateError, setDeactivateError] = useState('');

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
    setForm(blankForm());
    resetFormState();
    setCreating(true);
  }

  function openEdit(person: EmployeeRow) {
    setForm({
      name: person.name,
      jobTitle: person.jobTitle ?? '',
      phone: person.phone ?? '',
      email: person.email,
      password: '',
      role: person.role,
      scope: person.allDepartments || !person.departmentId ? 'ALL' : person.departmentId,
      access: person.account?.access ?? resolveAccess(person.role, {}),
    });
    resetFormState();
    setEditing(person);
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    resetFormState();
  }

  /** A new role starts from its own template - the point of picking one. */
  function changeRole(role: Role) {
    setForm((current) => ({
      ...current,
      role,
      access: resolveAccess(role, {}),
      // A department head is about one department, so default them to one.
      scope:
        role === 'DEPT_HEAD' && current.scope === 'ALL' && departments[0]
          ? departments[0].id
          : current.scope,
    }));
  }

  function setLevel(area: Area, level: Access[Area]) {
    setForm((current) => ({ ...current, access: { ...current.access, [area]: level } }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const shared = {
      name: form.name,
      email: form.email,
      jobTitle: form.jobTitle,
      phone: form.phone,
      role: form.role,
      allDepartments: form.scope === 'ALL',
      departmentId: form.scope === 'ALL' ? null : form.scope,
      access: form.access,
    };

    const result = editing
      ? await api<{ user: { id: string } }>(`/api/users/${editing.id}`, {
          method: 'PATCH',
          // The password is only sent when the admin actually typed a new one.
          json: { ...shared, ...(form.password ? { newPassword: form.password } : {}) },
        })
      : await api<{ user: { id: string } }>('/api/users', {
          method: 'POST',
          json: { ...shared, password: form.password },
        });

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    // The photo goes after the account exists, the same way an asset's does.
    const id = result.data.user.id;
    if (photoFile) {
      const uploaded = await uploadImage(`/api/users/${id}/photo`, photoFile);
      if (!uploaded.ok) {
        setBusy(false);
        setError(`${uploaded.error} The rest was saved without the photo.`);
        router.refresh();
        return;
      }
    } else if (removePhoto && editing?.photoUrl) {
      await api(`/api/users/${id}/photo`, { method: 'DELETE' });
    }

    setBusy(false);
    closeForm();
    router.refresh();
  }

  async function reactivate(person: EmployeeRow) {
    setBusy(true);
    await api(`/api/users/${person.id}`, { method: 'PATCH', json: { isActive: true } });
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

  const shownPhoto = photoPreview ?? (removePhoto ? null : (editing?.photoUrl ?? null));

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            {employees.length} {employees.length === 1 ? 'person' : 'people'}
          </h2>
          {isAdmin ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
              Add employee
            </button>
          ) : null}
        </div>

        {employees.length === 0 ? (
          <EmptyState title="Nobody here yet" message="Add the first employee." />
        ) : (
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Sees</th>
                  {isAdmin ? <th>Last signed in</th> : null}
                  {isAdmin ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {employees.map((person) => {
                  const custom = person.account
                    ? customCount(person.role, person.account.access)
                    : 0;
                  return (
                    <tr key={person.id} style={{ opacity: person.isActive ? 1 : 0.55 }}>
                      <td>
                        <div className="person">
                          <Avatar name={person.name} photoUrl={person.photoUrl} />
                          <div>
                            <span style={{ fontWeight: 600 }}>{person.name}</span>
                            {person.id === currentUserId ? (
                              <span className="pill pill-accent" style={{ marginLeft: 8 }}>
                                You
                              </span>
                            ) : null}
                            {!person.isActive ? (
                              <span className="pill pill-neutral" style={{ marginLeft: 6 }}>
                                Deactivated
                              </span>
                            ) : null}
                            <div className="cell-sub">
                              {[person.jobTitle, person.email].filter(Boolean).join(' · ')}
                            </div>
                            {person.account?.mustChangePassword && person.isActive ? (
                              <div className="cell-sub">Temporary password not yet changed</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="nowrap">
                        {person.phone ? (
                          <a href={`tel:${person.phone}`}>{person.phone}</a>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`pill pill-${person.role === 'ADMIN' ? 'accent' : 'neutral'}`}
                        >
                          {ROLE_LABELS[person.role]}
                        </span>
                        {custom > 0 ? (
                          <div className="cell-sub">
                            {custom} area{custom === 1 ? '' : 's'} customised
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {person.role === 'ADMIN' || person.allDepartments ? (
                          'All departments'
                        ) : person.departmentName ? (
                          person.departmentName
                        ) : (
                          <span className="muted">Only what is assigned</span>
                        )}
                      </td>
                      {isAdmin ? (
                        <td className="nowrap">
                          {person.account?.lastLoginAt ? (
                            formatDateTime(person.account.lastLoginAt)
                          ) : (
                            <span className="muted">Never</span>
                          )}
                        </td>
                      ) : null}
                      {isAdmin ? (
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEdit(person)}
                            >
                              Edit
                            </button>
                            {person.id === currentUserId ? null : person.isActive ? (
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => {
                                  setDeactivateError('');
                                  setDeactivating(person);
                                }}
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => reactivate(person)}
                                disabled={busy}
                              >
                                Reactivate
                              </button>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating || editing ? (
        <Modal
          wide
          title={editing ? `Edit ${editing.name}` : 'Add employee'}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="employee-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
              </button>
            </>
          }
        >
          <form id="employee-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}

            <div className="person-form-head">
              <div className="stack" style={{ gap: 6, alignItems: 'center' }}>
                {shownPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="avatar avatar-lg" src={shownPhoto} alt="" />
                ) : (
                  <Avatar name={form.name} photoUrl={null} size="lg" />
                )}
                <label className="btn btn-secondary btn-sm">
                  {shownPhoto ? 'Change photo' : 'Add photo'}
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
                  <Field label="Name" htmlFor="emp-name" error={fields.name}>
                    <input
                      id="emp-name"
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      autoFocus
                    />
                  </Field>
                  <Field label="Job title" htmlFor="emp-title" error={fields.jobTitle}>
                    <input
                      id="emp-title"
                      type="text"
                      value={form.jobTitle}
                      placeholder="e.g. Storekeeper"
                      onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="field-row">
                  <Field label="Phone" htmlFor="emp-phone" error={fields.phone}>
                    <input
                      id="emp-phone"
                      type="text"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Email"
                    htmlFor="emp-email"
                    error={fields.email}
                    hint="What they sign in with."
                  >
                    <input
                      id="emp-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </div>

            <Field
              label={editing ? 'Reset password' : 'Temporary password'}
              htmlFor="emp-password"
              error={fields.password ?? fields.newPassword}
              hint={
                editing
                  ? 'Leave blank to keep the current password. Setting one signs them out everywhere.'
                  : 'At least 10 characters. They must change it when they first sign in.'
              }
            >
              <input
                id="emp-password"
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="off"
              />
            </Field>

            <div className="field-row">
              <Field
                label="Role"
                htmlFor="emp-role"
                error={fields.role}
                hint="Picking a role fills in its usual access below. Any line can then be changed."
              >
                <select
                  id="emp-role"
                  value={form.role}
                  onChange={(e) => changeRole(e.target.value as Role)}
                >
                  {ROLE_ORDER.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </Field>

              {form.role === 'ADMIN' ? (
                <Field label="Departments" htmlFor="emp-scope-all">
                  <input id="emp-scope-all" type="text" value="All departments" disabled readOnly />
                </Field>
              ) : (
                <Field
                  label="Departments"
                  htmlFor="emp-scope"
                  error={fields.departmentId}
                  hint="Whose equipment and orders they see. Orders assigned to them are always visible."
                >
                  <select
                    id="emp-scope"
                    value={form.scope}
                    onChange={(e) => setForm({ ...form, scope: e.target.value })}
                  >
                    <option value="ALL">All departments</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        Only {department.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div className="section-label" style={{ marginTop: 4 }}>
              What they can open
            </div>
            {form.role === 'ADMIN' ? (
              <Alert kind="info">
                An administrator can open and change everything, including other people&rsquo;s
                accounts.
              </Alert>
            ) : (
              <div className="perm-grid">
                {AREAS.map((area) => {
                  const info = AREA_INFO[area];
                  const level = form.access[area];
                  const isDefault = level === ROLE_TEMPLATES[form.role][area];
                  return (
                    <div className="perm-row" key={area}>
                      <div className="perm-area">
                        {info.label}
                        {isDefault ? null : <span className="perm-custom">changed</span>}
                      </div>
                      <div className="switch" role="radiogroup" aria-label={info.label}>
                        {info.levels.map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={level === option}
                            className={level === option ? 'is-on' : undefined}
                            onClick={() => setLevel(area, option)}
                          >
                            {LEVEL_LABELS[option]}
                          </button>
                        ))}
                      </div>
                      <div className="perm-says">
                        {level === 'NONE' ? 'Hidden from them' : info.says[level]}
                      </div>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ justifySelf: 'start' }}
                  onClick={() => setForm({ ...form, access: resolveAccess(form.role, {}) })}
                >
                  Back to the {ROLE_LABELS[form.role].toLowerCase()} defaults
                </button>
              </div>
            )}
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
              They will be signed out immediately and will not be able to sign back in. Orders they
              were assigned and repairs they logged keep their name, so history stays readable. You
              can reactivate the account at any time.
            </>
          }
          onCancel={() => setDeactivating(null)}
          onConfirm={confirmDeactivate}
        />
      ) : null}
    </>
  );
}
