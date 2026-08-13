'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { AssetStatus, PurchasePriority, PurchaseStatus } from '@prisma/client';
import {
  ASSET_STATUS_LABELS,
  PURCHASE_PRIORITY_LABELS,
  PURCHASE_STATUS_LABELS,
} from '@/lib/format';

/** Small shared pieces. Kept in one file so the component surface stays small. */

// ---------------------------------------------------------------------------

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <div className="err">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'ok' | 'info' | 'warn';
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Escape closes; body scroll is locked so the page behind does not slide
  // around while a long form is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      ref={backdropRef}
      onMouseDown={(event) => {
        if (event.target === backdropRef.current) onClose();
      }}
    >
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * Replaces window.confirm for destructive actions, so the wording can explain
 * what is actually about to happen.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Status rendering - shared so every table agrees with the PDF.
// ---------------------------------------------------------------------------

const ASSET_STATUS_CLASS: Record<AssetStatus, string> = {
  IN_USE: 'ok',
  IDLE: 'idle',
  NEEDS_REPLACEMENT: 'warn',
  BROKEN: 'bad',
};

export function StatusPill({ status }: { status: AssetStatus }) {
  return (
    <span className={`pill pill-${ASSET_STATUS_CLASS[status]}`}>
      {ASSET_STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityPill({ priority }: { priority: PurchasePriority }) {
  const cls =
    priority === 'CRITICAL'
      ? 'bad'
      : priority === 'HIGH'
        ? 'warn'
        : priority === 'MEDIUM'
          ? 'idle'
          : 'neutral';
  return <span className={`pill pill-${cls}`}>{PURCHASE_PRIORITY_LABELS[priority]}</span>;
}

export function PurchaseStatusPill({ status }: { status: PurchaseStatus }) {
  const cls = status === 'APPROVED' ? 'ok' : status === 'REJECTED' ? 'bad' : 'neutral';
  return <span className={`pill pill-${cls}`}>{PURCHASE_STATUS_LABELS[status]}</span>;
}

/** Stacked condition bar, matching the one drawn in the PDF. */
export function StatusBar({
  counts,
  total,
}: {
  counts: Record<AssetStatus, number>;
  total: number;
}) {
  if (total === 0) return <div className="bar" />;

  const order: AssetStatus[] = ['IN_USE', 'IDLE', 'NEEDS_REPLACEMENT', 'BROKEN'];

  return (
    <div className="bar">
      {order
        .filter((status) => counts[status] > 0)
        .map((status) => (
          <div
            key={status}
            className={`bar-seg seg-${ASSET_STATUS_CLASS[status]}`}
            style={{ width: `${(counts[status] / total) * 100}%` }}
            title={`${ASSET_STATUS_LABELS[status]}: ${counts[status]}`}
          />
        ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}
