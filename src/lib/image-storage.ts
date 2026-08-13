import 'server-only';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from '@/lib/config';

/**
 * Asset photo storage.
 *
 * Photos live in an `images/` subfolder of the same storage root as the repair
 * videos, so there is still exactly one directory to back up and one disk to
 * keep an eye on.
 *
 *   <VIDEO_STORAGE_DIR>/images/<assetId>/<filename>.jpg
 *
 * Two deliberate differences from video storage:
 *
 *  - Photos are NOT reachable through the Cloudflare Tunnel. Only `/videos/*`
 *    is exposed publicly; an asset photo is internal data and is served through
 *    an authenticated route that re-checks the department scope.
 *  - There is no unguessable token, because there is no capability URL to
 *    protect - access is decided by the session, not by knowing the path.
 *
 * The browser downscales images before upload (see downscaleImage in
 * lib/client.ts), so what lands here is a small JPEG. That keeps table
 * thumbnails snappy and, more importantly, keeps the base64-inlined copies in
 * the PDF from bloating a CEO-facing document.
 */

const IMAGES_SUBDIR = 'images';

/** Hard ceiling. The client downscales well below this; this catches abuse. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function isAllowedImageMime(mime: string | null): boolean {
  if (!mime) return false;
  return ALLOWED_MIME.has(mime.split(';')[0].trim().toLowerCase());
}

export function imageMimeFor(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Photos are replaced in place, so the filename carries a short random suffix.
 * Without it, a browser that cached the old photo would keep showing it after
 * an upload.
 */
export function buildImageRelativePath(assetId: string, mime: string): string {
  const ext = EXTENSION_BY_MIME[mime.split(';')[0].trim().toLowerCase()] ?? '.jpg';
  const suffix = crypto.randomBytes(6).toString('hex');
  return path.posix.join(IMAGES_SUBDIR, assetId, `photo-${suffix}${ext}`);
}

export function imageAbsolutePathFor(relativePath: string): string {
  const resolved = path.resolve(config.videoStorageDir, relativePath);
  const root = path.resolve(config.videoStorageDir);

  // Defence in depth: never resolve outside the storage root, even though the
  // value comes from our own database.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Refusing to access a path outside the storage root.');
  }
  return resolved;
}

export class ImageTooLargeError extends Error {
  constructor() {
    super(`Image exceeds the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit.`);
    this.name = 'ImageTooLargeError';
  }
}

/**
 * Buffers the request body to memory and writes it.
 *
 * Buffering is fine here precisely because the client downscales first - these
 * are tens of kilobytes, not the hundreds of megabytes a repair video can be.
 * The size ceiling is enforced on bytes actually received.
 */
export async function saveImageStream(
  body: ReadableStream<Uint8Array>,
  relativePath: string,
): Promise<{ bytesWritten: number }> {
  const absolute = imageAbsolutePathFor(relativePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });

  const chunks: Buffer[] = [];
  let total = 0;

  const nodeStream = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);

  for await (const chunk of nodeStream) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_IMAGE_BYTES) throw new ImageTooLargeError();
    chunks.push(buf);
  }

  if (total === 0) return { bytesWritten: 0 };

  await fsp.writeFile(absolute, Buffer.concat(chunks));
  return { bytesWritten: total };
}

export async function readImage(relativePath: string): Promise<Buffer | null> {
  try {
    return await fsp.readFile(imageAbsolutePathFor(relativePath));
  } catch {
    return null;
  }
}

/**
 * Reads a photo back as a base64 data URI for embedding in the PDF.
 *
 * The report is rendered with all network access blocked, so an <img src="/…">
 * would silently render as a broken image in a document going to the CEO.
 * Inlining removes that failure mode, and means the photos travel inside the
 * PDF file itself - so they still display when it is opened off-site.
 */
export async function readImageAsDataUri(relativePath: string): Promise<string | null> {
  const buffer = await readImage(relativePath);
  if (!buffer) return null;
  return `data:${imageMimeFor(relativePath)};base64,${buffer.toString('base64')}`;
}

/** Removes a photo and its now-empty asset folder. Never throws. */
export async function deleteImageQuietly(
  relativePath: string | null | undefined,
): Promise<void> {
  if (!relativePath) return;
  try {
    const absolute = imageAbsolutePathFor(relativePath);
    await fsp.rm(absolute, { force: true });
    await fsp.rmdir(path.dirname(absolute)).catch(() => {});
  } catch (error) {
    console.error('[image-storage] failed to delete', relativePath, error);
  }
}
