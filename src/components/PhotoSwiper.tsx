'use client';

import { useRef, useState } from 'react';

/**
 * A row of photos one frame wide that swipes sideways. The swiping is the
 * browser's own scroll snapping, so a finger on a phone and a trackpad both
 * work without any code; the arrows are for a mouse, which cannot swipe.
 *
 * It sits inside a card that is a link, so every press on its own controls
 * stops there rather than opening the machine.
 */
export function PhotoSwiper({
  photos,
  name,
  className,
  onOpen,
}: {
  photos: Array<{ id: string; url: string }>;
  /** What the photos are of, for the empty frame and the labels. */
  name: string;
  /** Sizes the frame: `machine-card-photo` or `machine-head-swiper`. */
  className: string;
  /** Clicking a photo opens it, when given. */
  onOpen?: (index: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <div className={`${className} swiper-empty`} aria-hidden="true">
        {name[0]?.toUpperCase()}
      </div>
    );
  }

  function go(event: React.MouseEvent, to: number) {
    event.preventDefault();
    event.stopPropagation();
    const node = track.current;
    if (!node) return;
    const next = (to + photos.length) % photos.length;
    node.scrollTo({ left: next * node.clientWidth, behavior: 'smooth' });
  }

  return (
    <div className={`${className} swiper`}>
      <div
        ref={track}
        className="swiper-track"
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.clientWidth > 0) setIndex(Math.round(node.scrollLeft / node.clientWidth));
        }}
      >
        {photos.map((photo, i) =>
          onOpen ? (
            <button
              key={photo.id}
              type="button"
              className="swiper-slide swiper-open"
              onClick={() => onOpen(i)}
              aria-label={`Open photo ${i + 1} of ${name}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" draggable={false} loading={i === 0 ? undefined : 'lazy'} />
            </button>
          ) : (
            <div key={photo.id} className="swiper-slide">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" draggable={false} loading={i === 0 ? undefined : 'lazy'} />
            </div>
          ),
        )}
      </div>

      {photos.length > 1 ? (
        <>
          <button type="button" className="swiper-arrow swiper-prev" aria-label="Previous photo" onClick={(e) => go(e, index - 1)}>
            ‹
          </button>
          <button type="button" className="swiper-arrow swiper-next" aria-label="Next photo" onClick={(e) => go(e, index + 1)}>
            ›
          </button>
          <div className="swiper-dots" aria-hidden="true">
            {photos.map((photo, i) => (
              <span key={photo.id} className={i === index ? 'is-on' : undefined} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
