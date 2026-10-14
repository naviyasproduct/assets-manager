'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { AssetStatus, MachineStatus, PurchaseOrderStatus } from '@prisma/client';
import { ASSET_STATUS_LABELS, MACHINE_STATUS_LABELS, ORDER_STATUS_LABELS } from '@/lib/format';

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
      // A picker inside the form gets the Escape first, to shut its own list.
      // stopPropagation cannot say so - React delegates from `document`, which
      // is where this listener sits too - so preventDefault is the signal, and
      // the half-filled form survives closing a dropdown.
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
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

/** Where each floating window was last left, so it reopens there. Per tab, per window name. */
const lastWindowPosition = new Map<string, { x: number; y: number }>();
/** How much of the title bar must stay on screen, so it can always be dragged back. */
const KEEP_VISIBLE = 120;

/**
 * A form in a window that can be dragged around by its title bar, with no
 * backdrop: the page behind stays visible and scrollable, so the list being
 * added to can be read while filling it in. Escape still closes it, with the
 * same give-way to an open dropdown as Modal.
 */
export function FloatingWindow({
  name,
  title,
  onClose,
  children,
  footer,
  width = 720,
}: {
  /** Remembers the position under this key. */
  name: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Keeps at least the title bar inside the window, whatever the screen size.
  const clamp = useCallback((x: number, y: number) => {
    const w = boxRef.current?.offsetWidth ?? width;
    return {
      x: Math.min(Math.max(x, KEEP_VISIBLE - w), window.innerWidth - KEEP_VISIBLE),
      y: Math.min(Math.max(y, 0), window.innerHeight - 48),
    };
  }, [width]);

  // First open sits to the right, leaving the list on the left in view.
  useLayoutEffect(() => {
    const saved = lastWindowPosition.get(name);
    const w = Math.min(width, window.innerWidth - 32);
    setPos(saved ? clamp(saved.x, saved.y) : { x: Math.max(16, window.innerWidth - w - 24), y: 24 });
  }, [name, width, clamp]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose, clamp]);

  useEffect(() => {
    if (pos) lastWindowPosition.set(name, pos);
  }, [name, pos]);

  return (
    <div
      ref={boxRef}
      className="floating"
      role="dialog"
      aria-label={title}
      style={{ width: `min(${width}px, calc(100vw - 32px))`, left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div
        className="floating-head"
        onPointerDown={(event) => {
          // The close button is in the bar; a press on it is not a drag.
          if ((event.target as HTMLElement).closest('button') || !pos) return;
          drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPos(clamp(event.clientX - drag.current.dx, event.clientY - drag.current.dy));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span className="floating-grip" aria-hidden="true">⠿</span>
        <h2>{title}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="floating-body">{children}</div>
      {footer ? <div className="modal-foot">{footer}</div> : null}
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

/**
 * Goes back to wherever the person came from, so a filtered or searched list
 * comes back as they left it. A page opened straight from a bookmark or a new
 * tab has nothing in this app to go back to, and goes to `fallback` instead.
 */
export function BackButton({ fallback, children }: { fallback: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <a
      href={fallback}
      className="btn btn-secondary"
      onClick={(event) => {
        // The Navigation API only lists this site's own entries, so canGoBack
        // means "there is an earlier page of this app in the tab". In-app
        // navigation never updates document.referrer, so that cannot tell.
        // Without the API, any history at all is the best guess.
        const navigation = (window as { navigation?: { canGoBack?: boolean } }).navigation;
        const canGoBack =
          typeof navigation?.canGoBack === 'boolean' ? navigation.canGoBack : window.history.length > 1;
        if (!canGoBack) return;
        event.preventDefault();
        router.back();
      }}
    >
      {children}
    </a>
  );
}

const MACHINE_STATUS_CLASS: Record<MachineStatus, string> = {
  RUNNING: 'ok',
  UNDER_REPAIR: 'warn',
  STOPPED: 'bad',
};

export function MachineStatusPill({ status }: { status: MachineStatus }) {
  return (
    <span className={`pill pill-${MACHINE_STATUS_CLASS[status]}`}>{MACHINE_STATUS_LABELS[status]}</span>
  );
}

export function StatusPill({ status }: { status: AssetStatus }) {
  return (
    <span className={`pill pill-${ASSET_STATUS_CLASS[status]}`}>
      {ASSET_STATUS_LABELS[status]}
    </span>
  );
}

const ORDER_STATUS_CLASS: Record<PurchaseOrderStatus, string> = {
  NEW: 'neutral',
  PENDING: 'warn',
  COMPLETED: 'ok',
};

export function OrderStatusPill({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span className={`pill pill-${ORDER_STATUS_CLASS[status]}`}>{ORDER_STATUS_LABELS[status]}</span>
  );
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
