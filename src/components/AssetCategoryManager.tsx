'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { assetTagPrefix } from '@/lib/format';
import { Field, Alert, Modal, ConfirmDialog, EmptyState } from '@/components/ui';

export type CategoryRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  assetCount: number;
};

export type CategoryDepartmentGroup = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  categories: CategoryRow[];
};

type FormState = { name: string; code: string; description: string; isActive: boolean };

const blankForm: FormState = { name: '', code: '', description: '', isActive: true };

function suggestCode(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
}

/**
 * Categories are managed under the department that owns them, because that is
 * the only place they mean anything: "Nuts" in the Workshop and "Nuts" in
 * Printing are two different piles of stock with two different tag runs.
 */
export function AssetCategoryManager({
  groups,
  canAddDepartment,
}: {
  groups: CategoryDepartmentGroup[];
  canAddDepartment: boolean;
}) {
  const router = useRouter();

  const [query, setQuery] = useState('');

  const [creatingIn, setCreatingIn] = useState<CategoryDepartmentGroup | null>(null);
  const [editing, setEditing] = useState<{ group: CategoryDepartmentGroup; category: CategoryRow } | null>(
    null,
  );
  const [form, setForm] = useState<FormState>(blankForm);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const openGroup = creatingIn ?? editing?.group ?? null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;

    return groups
      .map((group) => ({
        ...group,
        categories: group.name.toLowerCase().includes(q)
          ? group.categories
          : group.categories.filter(
              (category) =>
                category.name.toLowerCase().includes(q) ||
                category.code.toLowerCase().includes(q),
            ),
      }))
      .filter((group) => group.categories.length > 0 || group.name.toLowerCase().includes(q));
  }, [groups, query]);

  const totalCategories = groups.reduce((sum, group) => sum + group.categories.length, 0);

  function openCreate(group: CategoryDepartmentGroup) {
    setForm(blankForm);
    setError('');
    setFields({});
    setEditing(null);
    setCreatingIn(group);
  }

  function openEdit(group: CategoryDepartmentGroup, category: CategoryRow) {
    setForm({
      name: category.name,
      code: category.code,
      description: category.description ?? '',
      isActive: category.isActive,
    });
    setError('');
    setFields({});
    setCreatingIn(null);
    setEditing({ group, category });
  }

  function closeForm() {
    setCreatingIn(null);
    setEditing(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const result = editing
      ? await api(`/api/asset-categories/${editing.category.id}`, {
          method: 'PATCH',
          json: form,
        })
      : await api('/api/asset-categories', {
          method: 'POST',
          json: { ...form, departmentId: creatingIn?.id },
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

  async function confirmDelete(mode?: 'deactivate') {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');

    const result = await api(
      `/api/asset-categories/${deleting.id}${mode ? `?mode=${mode}` : ''}`,
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

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="toolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories or departments…"
            aria-label="Search categories"
          />
          <div className="toolbar-spacer" />
          <span className="muted" style={{ fontSize: 12.5 }}>
            {totalCategories} categor{totalCategories === 1 ? 'y' : 'ies'} across {groups.length}{' '}
            department{groups.length === 1 ? '' : 's'}
          </span>
          {canAddDepartment ? (
            <Link href="/departments/new" className="btn btn-secondary btn-sm">
              Add department
            </Link>
          ) : null}
        </div>

        {groups.length === 0 ? (
          <EmptyState
            title="No departments yet"
            message="Categories live inside a department, so add a department first."
            action={
              canAddDepartment ? (
                <Link href="/departments/new" className="btn btn-primary">
                  Add department
                </Link>
              ) : undefined
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState title="No matches" message="No category or department matches that search." />
        ) : null}
      </div>

      <div className="stack">
        {visible.map((group) => (
          <div className="card" key={group.id}>
            <div className="card-head">
              <div className="row" style={{ gap: 10 }}>
                <h2>
                  <Link href={`/departments/${group.id}`}>{group.name}</Link>
                </h2>
                <span className="pill pill-accent mono">{group.code}</span>
                {!group.isActive ? <span className="pill pill-neutral">Inactive</span> : null}
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {group.categories.length} categor{group.categories.length === 1 ? 'y' : 'ies'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => openCreate(group)}
              >
                Add category
              </button>
            </div>

            {group.categories.length === 0 ? (
              <EmptyState
                title="No categories yet"
                message={`Group ${group.name}'s equipment - nuts, presses, workstations - so every asset tag says what it is.`}
                action={
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => openCreate(group)}
                  >
                    Add the first category
                  </button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Tag format</th>
                      <th className="num">Assets</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {group.categories.map((category) => (
                      <tr key={category.id}>
                        <td>
                          <span style={{ fontWeight: 600 }}>{category.name}</span>
                          <span className="pill pill-neutral mono" style={{ marginLeft: 8 }}>
                            {category.code}
                          </span>
                          {!category.isActive ? (
                            <span className="pill pill-neutral" style={{ marginLeft: 6 }}>
                              Inactive
                            </span>
                          ) : null}
                          {category.description ? (
                            <div className="cell-sub">{category.description}</div>
                          ) : null}
                        </td>
                        <td className="mono nowrap muted">
                          {assetTagPrefix(group.code, category.code)}
                          <span aria-hidden="true">###</span>
                        </td>
                        <td className="num">
                          {category.assetCount > 0 ? (
                            <Link href={`/assets?categoryId=${category.id}`}>
                              {category.assetCount}
                            </Link>
                          ) : (
                            <span className="muted">0</span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEdit(group, category)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                setDeleteError('');
                                setDeleting(category);
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
        ))}
      </div>

      {creatingIn || editing ? (
        <Modal
          title={editing ? `Edit ${editing.category.name}` : `New category in ${creatingIn?.name}`}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="category-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Add category'}
              </button>
            </>
          }
        >
          <form id="category-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}

            <div className="field-row">
              <Field label="Name" htmlFor="category-name" error={fields.name}>
                <input
                  id="category-name"
                  type="text"
                  value={form.name}
                  autoFocus
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      name: e.target.value,
                      // Follows the name until the code is edited by hand.
                      code:
                        current.code === suggestCode(current.name)
                          ? suggestCode(e.target.value)
                          : current.code,
                    }))
                  }
                  required
                />
              </Field>

              <Field
                label="Code"
                htmlFor="category-code"
                error={fields.code}
                hint={
                  openGroup && form.code
                    ? `New assets are tagged ${assetTagPrefix(openGroup.code, form.code)}001.`
                    : 'Two or more letters or numbers, e.g. NUT.'
                }
              >
                <input
                  id="category-code"
                  type="text"
                  className="mono"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  maxLength={10}
                  required
                />
              </Field>
            </div>

            <Field label="Description" htmlFor="category-description" error={fields.description}>
              <textarea
                id="category-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional. What belongs in this group."
              />
            </Field>

            {editing ? (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                Available when adding assets
              </label>
            ) : null}

            {editing && editing.category.code !== form.code ? (
              <div className="warn-note" style={{ marginTop: 12 }}>
                Tags already printed keep the old code - only assets added from now on use{' '}
                <span className="mono">{assetTagPrefix(editing.group.code, form.code)}</span>.
              </div>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Remove ${deleting.name}?`}
          confirmLabel={deleting.assetCount > 0 ? 'Deactivate instead' : 'Remove category'}
          busy={busy}
          error={deleteError}
          message={
            deleting.assetCount > 0 ? (
              <>
                This category still holds <strong>{deleting.assetCount} asset(s)</strong>, and an
                asset cannot exist without one.
                <br />
                <br />
                Deactivating keeps every record and only takes the category out of the add-asset
                list. Move the assets to another category first if you truly want it gone.
              </>
            ) : (
              <>
                This category holds no assets, so it can be removed permanently. Nothing else
                references it.
              </>
            )
          }
          onCancel={() => setDeleting(null)}
          onConfirm={() => confirmDelete(deleting.assetCount > 0 ? 'deactivate' : undefined)}
        />
      ) : null}
    </>
  );
}
