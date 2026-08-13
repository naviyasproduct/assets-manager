'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PurchaseKind, PurchasePriority, PurchaseStatus } from '@prisma/client';
import { api } from '@/lib/client';
import {
  PURCHASE_PRIORITY_LABELS,
  PURCHASE_PRIORITY_ORDER,
  PURCHASE_KIND_LABELS,
  formatMoney,
  formatDate,
} from '@/lib/format';
import {
  Field,
  Alert,
  Modal,
  ConfirmDialog,
  PriorityPill,
  PurchaseStatusPill,
  EmptyState,
} from '@/components/ui';
import type { DepartmentOption } from '@/components/AssetManager';

export type PurchaseRow = {
  id: string;
  title: string;
  category: string;
  kind: PurchaseKind;
  quantity: number;
  estimatedCost: number | null;
  lineTotal: number | null;
  justification: string;
  priority: PurchasePriority;
  status: PurchaseStatus;
  departmentId: string;
  departmentName: string;
  requestedByName: string;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  replacesAssetId: string | null;
  replacesAssetTag: string | null;
  replacesAssetName: string | null;
};

export type ReplaceableAsset = {
  id: string;
  assetTag: string;
  name: string;
  departmentId: string;
};

type FormState = {
  title: string;
  category: string;
  departmentId: string;
  kind: PurchaseKind;
  quantity: string;
  estimatedCost: string;
  justification: string;
  priority: PurchasePriority;
  replacesAssetId: string;
};

function blankForm(departmentId: string): FormState {
  return {
    title: '',
    category: '',
    departmentId,
    kind: 'NEW',
    quantity: '1',
    estimatedCost: '',
    justification: '',
    priority: 'MEDIUM',
    replacesAssetId: '',
  };
}

export function PurchaseManager({
  requests,
  departments,
  assets,
  isAdmin,
  showDepartmentColumn,
}: {
  requests: PurchaseRow[];
  departments: DepartmentOption[];
  assets: ReplaceableAsset[];
  isAdmin: boolean;
  showDepartmentColumn: boolean;
}) {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState<PurchaseStatus | 'ALL'>('ALL');
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm(departments[0]?.id ?? ''));
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [reviewing, setReviewing] = useState<PurchaseRow | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [reviewNote, setReviewNote] = useState('');

  const [deleting, setDeleting] = useState<PurchaseRow | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const filtered = useMemo(
    () =>
      statusFilter === 'ALL'
        ? requests
        : requests.filter((request) => request.status === statusFilter),
    [requests, statusFilter],
  );

  // Only assets in the selected department can be the thing being replaced.
  const replaceableInDepartment = useMemo(
    () => assets.filter((asset) => asset.departmentId === form.departmentId),
    [assets, form.departmentId],
  );

  function openCreate() {
    setForm(blankForm(departments[0]?.id ?? ''));
    setError('');
    setFields({});
    setCreating(true);
  }

  function openEdit(request: PurchaseRow) {
    setForm({
      title: request.title,
      category: request.category,
      departmentId: request.departmentId,
      kind: request.kind,
      quantity: String(request.quantity),
      estimatedCost: request.estimatedCost === null ? '' : String(request.estimatedCost),
      justification: request.justification,
      priority: request.priority,
      replacesAssetId: request.replacesAssetId ?? '',
    });
    setError('');
    setFields({});
    setEditing(request);
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

    const payload = {
      ...form,
      quantity: Number(form.quantity) || 1,
      replacesAssetId: form.kind === 'REPLACEMENT' ? form.replacesAssetId || null : null,
    };

    const result = editing
      ? await api(`/api/purchase-requests/${editing.id}`, { method: 'PATCH', json: payload })
      : await api('/api/purchase-requests', { method: 'POST', json: payload });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      setFields(result.fields ?? {});
      return;
    }

    closeForm();
    router.refresh();
  }

  async function submitReview() {
    if (!reviewing) return;
    setBusy(true);
    setError('');

    const result = await api(`/api/purchase-requests/${reviewing.id}/review`, {
      method: 'POST',
      json: { status: reviewDecision, reviewNote },
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setReviewing(null);
    setReviewNote('');
    router.refresh();
  }

  async function reopen(request: PurchaseRow) {
    setBusy(true);
    await api(`/api/purchase-requests/${request.id}/review`, { method: 'DELETE' });
    setBusy(false);
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');

    const result = await api(`/api/purchase-requests/${deleting.id}`, { method: 'DELETE' });
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
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PurchaseStatus | 'ALL')}
            aria-label="Filter by status"
          >
            <option value="ALL">All requests</option>
            <option value="PENDING">Pending review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>

          <div className="toolbar-spacer" />

          <span className="muted" style={{ fontSize: 12.5 }}>
            {filtered.length} of {requests.length}
          </span>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openCreate}
            disabled={departments.length === 0}
          >
            Flag a purchase need
          </button>
        </div>

        {requests.length === 0 ? (
          <EmptyState
            title="Nothing flagged"
            message="When a department needs to buy or replace something, flag it here so it reaches the CEO in the next report."
            action={
              departments.length > 0 ? (
                <button type="button" className="btn btn-primary" onClick={openCreate}>
                  Flag a purchase need
                </button>
              ) : undefined
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches" message="No requests with that status." />
        ) : (
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Item</th>
                  {showDepartmentColumn ? <th>Department</th> : null}
                  <th>Type</th>
                  <th className="num">Qty</th>
                  <th className="num">Estimate</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((request) => (
                  <tr key={request.id}>
                    <td style={{ maxWidth: 360 }}>
                      <span style={{ fontWeight: 600 }}>{request.title}</span>
                      <div className="cell-sub">{request.category}</div>
                      {request.replacesAssetTag ? (
                        <div className="cell-sub">
                          Replaces <span className="mono">{request.replacesAssetTag}</span> ·{' '}
                          {request.replacesAssetName}
                        </div>
                      ) : null}
                      <div className="cell-sub" style={{ marginTop: 5 }}>
                        {request.justification}
                      </div>
                      <div className="cell-sub" style={{ marginTop: 5 }}>
                        Raised by {request.requestedByName} on {formatDate(request.requestedAt)}
                      </div>
                      {request.reviewedByName ? (
                        <div className="cell-sub">
                          Reviewed by {request.reviewedByName} on {formatDate(request.reviewedAt)}
                          {request.reviewNote ? ` - “${request.reviewNote}”` : ''}
                        </div>
                      ) : null}
                    </td>
                    {showDepartmentColumn ? <td>{request.departmentName}</td> : null}
                    <td className="nowrap">{PURCHASE_KIND_LABELS[request.kind]}</td>
                    <td className="num">{request.quantity}</td>
                    <td className="num nowrap">
                      {formatMoney(request.lineTotal)}
                      {request.quantity > 1 && request.estimatedCost !== null ? (
                        <div className="cell-sub">{formatMoney(request.estimatedCost)} each</div>
                      ) : null}
                    </td>
                    <td>
                      <PriorityPill priority={request.priority} />
                    </td>
                    <td>
                      <PurchaseStatusPill status={request.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        {isAdmin && request.status === 'PENDING' ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              setReviewDecision('APPROVED');
                              setReviewNote('');
                              setError('');
                              setReviewing(request);
                            }}
                          >
                            Review
                          </button>
                        ) : null}
                        {isAdmin && request.status !== 'PENDING' ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => reopen(request)}
                            disabled={busy}
                          >
                            Reopen
                          </button>
                        ) : null}
                        {request.status === 'PENDING' || isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEdit(request)}
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            setDeleteError('');
                            setDeleting(request);
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
          title={editing ? 'Edit purchase need' : 'Flag a purchase need'}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
                Cancel
              </button>
              <button type="submit" form="purchase-form" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Flag it'}
              </button>
            </>
          }
        >
          <form id="purchase-form" onSubmit={submit} noValidate>
            {error ? <Alert>{error}</Alert> : null}

            <Field
              label="What needs to be bought"
              htmlFor="pr-title"
              error={fields.title}
              hint="Be specific - this is the line the CEO reads."
            >
              <input
                id="pr-title"
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                autoFocus
                required
              />
            </Field>

            <div className="field-row">
              <Field label="Category" htmlFor="pr-category" error={fields.category}>
                <input
                  id="pr-category"
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  required
                />
              </Field>

              <Field label="Department" htmlFor="pr-department" error={fields.departmentId}>
                <select
                  id="pr-department"
                  value={form.departmentId}
                  onChange={(e) =>
                    setForm({ ...form, departmentId: e.target.value, replacesAssetId: '' })
                  }
                  disabled={!!editing}
                  required
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="field-row">
              <Field label="Type" htmlFor="pr-kind" error={fields.kind}>
                <select
                  id="pr-kind"
                  value={form.kind}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      kind: e.target.value as PurchaseKind,
                      replacesAssetId: e.target.value === 'NEW' ? '' : form.replacesAssetId,
                    })
                  }
                >
                  <option value="NEW">{PURCHASE_KIND_LABELS.NEW}</option>
                  <option value="REPLACEMENT">{PURCHASE_KIND_LABELS.REPLACEMENT}</option>
                </select>
              </Field>

              <Field label="Priority" htmlFor="pr-priority" error={fields.priority}>
                <select
                  id="pr-priority"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value as PurchasePriority })
                  }
                >
                  {PURCHASE_PRIORITY_ORDER.map((priority) => (
                    <option key={priority} value={priority}>
                      {PURCHASE_PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {form.kind === 'REPLACEMENT' ? (
              <Field
                label="Which asset is being replaced"
                htmlFor="pr-replaces"
                error={fields.replacesAssetId}
                hint="Links the request to the machine, so the report shows them together."
              >
                <select
                  id="pr-replaces"
                  value={form.replacesAssetId}
                  onChange={(e) => setForm({ ...form, replacesAssetId: e.target.value })}
                  required
                >
                  <option value="">Select an asset…</option>
                  {replaceableInDepartment.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.assetTag} - {asset.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <div className="field-row">
              <Field label="Quantity" htmlFor="pr-quantity" error={fields.quantity}>
                <input
                  id="pr-quantity"
                  type="number"
                  min="1"
                  step="1"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  required
                />
              </Field>

              <Field
                label="Estimated cost each"
                htmlFor="pr-cost"
                error={fields.estimatedCost}
                hint="Leave blank if not yet quoted."
              >
                <input
                  id="pr-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.estimatedCost}
                  onChange={(e) => setForm({ ...form, estimatedCost: e.target.value })}
                />
              </Field>
            </div>

            <Field
              label="Justification"
              htmlFor="pr-justification"
              error={fields.justification}
              hint="Why it is needed and what happens if it is not approved. This appears in the CEO's report."
            >
              <textarea
                id="pr-justification"
                value={form.justification}
                onChange={(e) => setForm({ ...form, justification: e.target.value })}
                rows={4}
                required
              />
            </Field>
          </form>
        </Modal>
      ) : null}

      {reviewing ? (
        <Modal
          title="Review purchase request"
          onClose={() => setReviewing(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setReviewing(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitReview}
                disabled={busy}
              >
                {busy ? 'Saving…' : reviewDecision === 'APPROVED' ? 'Approve' : 'Reject'}
              </button>
            </>
          }
        >
          {error ? <Alert>{error}</Alert> : null}

          <p style={{ marginTop: 0 }}>
            <strong>{reviewing.title}</strong>
            <br />
            <span className="muted">
              {reviewing.departmentName} · {reviewing.quantity} × {reviewing.category} ·{' '}
              {formatMoney(reviewing.lineTotal)}
            </span>
          </p>

          <p style={{ fontSize: 13.5 }}>{reviewing.justification}</p>

          <div className="divider" />

          <Field label="Decision" htmlFor="review-decision">
            <select
              id="review-decision"
              value={reviewDecision}
              onChange={(e) => setReviewDecision(e.target.value as 'APPROVED' | 'REJECTED')}
            >
              <option value="APPROVED">Approve</option>
              <option value="REJECTED">Reject</option>
            </select>
          </Field>

          <Field
            label="Note"
            htmlFor="review-note"
            hint="Optional. Shown alongside the decision in the app."
          >
            <textarea
              id="review-note"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
            />
          </Field>
        </Modal>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Remove this request?"
          confirmLabel="Remove request"
          busy={busy}
          error={deleteError}
          message={
            <>
              This withdraws <strong>{deleting.title}</strong> and removes it from future reports.
            </>
          }
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </>
  );
}
