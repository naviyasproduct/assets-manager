'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { uploadAssetPhoto } from '@/lib/client';

/**
 * The asset photo as it appears in a table: a 50px square that shows a large
 * preview on hover and opens full screen from there.
 *
 * The preview is a fixed-position card in a portal rather than an absolutely
 * positioned child, because `.table-wrap` scrolls horizontally and would clip
 * anything that grew outside a cell. Fixed positioning also means the card can
 * flip to the other side of the thumbnail when the row is near the right edge.
 *
 * The thumbnail is a button, not a bare image: hover is not available to anyone
 * on a keyboard or a touchscreen, and clicking through to the full-size photo is
 * the same thing the preview's own button does.
 *
 * Uploads are downscaled to 640px on the long edge (see `downscaleImage`), so
 * the full-screen view is an upscale on a large monitor. That is the trade the
 * upload cap already made, and it is still the fastest way to tell two machines
 * apart.
 */

/** Preview edge length, before it is squeezed to fit a small window. */
const CARD = 320;
const GAP = 12;
const EDGE = 12;
/** Card height on top of the square image: 8px padding twice, 26px caption.
    Fixed in CSS so this arithmetic stays true. */
const CHROME = 42;

// Long enough that running the pointer down the table does not flash a card on
// every row, short enough that stopping on one feels immediate.
const OPEN_DELAY = 130;
// Covers the pointer crossing the gap between the thumbnail and the card.
const CLOSE_DELAY = 140;

type Placement = { top: number; left: number; size: number };

export function PhotoThumb({ src, name }: { src: string | null; name: string }) {
  if (!src) {
    return (
      <div className="thumb thumb-empty" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return <HoverablePhoto src={src} name={name} />;
}

/**
 * The empty photo square, for someone who may edit: a pen that opens the file
 * picker, so a photo goes on straight from the list instead of through the
 * asset's page. An image file dropped on it works too - photos usually sit in
 * a folder on the same PC. Uploaded the same way as from the form (downscaled
 * first), and the list refreshes to show it.
 */
export function AddPhotoButton({
  assetId,
  name,
  onError,
}: {
  assetId: string;
  name: string;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError(`"${file.name}" is not an image.`);
      return;
    }
    setBusy(true);
    onError('');
    const result = await uploadAssetPhoto(assetId, file);
    setBusy(false);
    if (!result.ok) onError(`${name}: ${result.error}`);
    router.refresh();
  }

  // Only a dragged file is taken here. A row being dragged by its grip passes
  // over the square too, and that drop belongs to the row.
  const carriesFile = (event: React.DragEvent) => event.dataTransfer.types.includes('Files');

  return (
    <>
      <button
        type="button"
        className={`thumb thumb-empty thumb-add${over ? ' is-over' : ''}`}
        onClick={() => input.current?.click()}
        disabled={busy}
        title={`Add a photo of ${name}`}
        aria-label={`Add a photo of ${name}`}
        onDragOver={(event) => {
          if (!carriesFile(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          if (!carriesFile(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setOver(false);
          void upload(event.dataTransfer.files[0]);
        }}
      >
        {busy ? <span className="thumb-add-busy">…</span> : <Icon name="pen" className="icon-sm" />}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          // Cleared so choosing the same file again after an error still fires.
          event.target.value = '';
        }}
      />
    </>
  );
}

/**
 * The same hover preview around anything else - the tag chips in the asset
 * form use it, so a photo there grows exactly as it does in the list.
 */
export function HoverablePhoto({
  src,
  name,
  children,
  className = 'thumb-btn',
}: {
  src: string;
  name: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [full, setFull] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setPlacement(null);
  }, [clearTimer]);

  const open = useCallback(
    (delay: number) => {
      clearTimer();
      timer.current = setTimeout(() => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (rect) setPlacement(place(rect));
      }, delay);
    },
    [clearTimer],
  );

  const scheduleClose = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setPlacement(null), CLOSE_DELAY);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  // A card pinned to viewport coordinates is wrong the moment anything moves,
  // so it goes away rather than following. Capture, because the scrolling
  // element is usually the table wrapper and not the window.
  useEffect(() => {
    if (!placement) return;

    const onKey = (event: KeyboardEvent) => {
      // Captured and marked handled, so a form window behind the photo keeps
      // its half-typed contents (it ignores an Escape that is defaultPrevented).
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [placement, close]);

  function openFull() {
    close();
    setFull(true);
  }

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className={className}
        aria-label={`View photo of ${name}`}
        onMouseEnter={() => open(OPEN_DELAY)}
        onMouseLeave={scheduleClose}
        onFocus={() => open(0)}
        onBlur={close}
        onClick={openFull}
      >
        {children ?? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="thumb" loading="lazy" width={50} height={50} />
        )}
      </button>

      {placement
        ? createPortal(
            <div
              className="photo-pop"
              style={{ top: placement.top, left: placement.left, width: placement.size }}
              onMouseEnter={clearTimer}
              onMouseLeave={scheduleClose}
            >
              <div className="photo-pop-frame" style={{ height: placement.size }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={name} className="photo-pop-img" />

                <button type="button" className="photo-pop-btn" onClick={openFull}>
                  <Icon name="expand" className="icon-sm" />
                  Full screen
                </button>
              </div>

              <div className="photo-pop-name">{name}</div>
            </div>,
            document.body,
          )
        : null}

      {full ? <Lightbox src={src} name={name} onClose={() => setFull(false)} /> : null}
    </>
  );
}

/** Beside the thumbnail, flipped to its left when the right edge is too close. */
function place(rect: DOMRect): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const size = Math.min(CARD, vw - EDGE * 2, vh - EDGE * 2 - CHROME);
  const height = size + CHROME;

  let left = rect.right + GAP;
  if (left + size > vw - EDGE) left = rect.left - GAP - size;
  left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - size - EDGE));

  // Centred on the row, then pulled back inside the window - against the whole
  // card, not just the image, or the bottom rows hang off the screen.
  let top = rect.top + rect.height / 2 - height / 2;
  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - height - EDGE));

  return { top, left, size };
}

export function Lightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Same bargain as Modal: Escape closes, and the page behind stops scrolling.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="lightbox"
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo of ${name}`}
      onMouseDown={(event) => {
        if (event.target === backdropRef.current) onClose();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={name} className="lightbox-img" />

      <div className="lightbox-name">{name}</div>

      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>,
    document.body,
  );
}
