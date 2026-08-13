import 'server-only';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from '@/lib/config';

/**
 * Machine-fix video storage.
 *
 * Design constraints that shaped this file:
 *  - Videos live on the office PC's large local disk, never in the database.
 *  - Only /videos/* is exposed through the Cloudflare Tunnel, so the URL for a
 *    video must be guessable by nobody: access control IS the URL. Each fix gets
 *    a 32-byte random token, so the public link is a capability URL.
 *  - Files can be large (a phone video of a repair is easily 500 MB), so upload
 *    streams straight to disk. Nothing is ever buffered whole in memory.
 */

const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
  'video/3gpp',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/webm': '.webm',
  'video/x-msvideo': '.avi',
  'video/mpeg': '.mpeg',
  'video/3gpp': '.3gp',
};

export const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
};

export function isAllowedVideoMime(mime: string | null): boolean {
  if (!mime) return false;
  return ALLOWED_MIME.has(mime.split(';')[0].trim().toLowerCase());
}

export function newVideoToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Strips anything that could escape the storage directory or upset a filesystem,
 * while keeping the name recognisable to a human browsing the folder.
 */
export function sanitizeFileName(original: string, mime: string): string {
  const ext =
    EXTENSION_BY_MIME[mime.split(';')[0].trim().toLowerCase()] ??
    (path.extname(original).toLowerCase().slice(0, 6) || '.mp4');

  const base = path
    .basename(original, path.extname(original))
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);

  return `${base || 'repair-video'}${ext}`;
}

/**
 * Relative layout inside the storage root:
 *   <assetId>/<token>/<filename>
 * Keeping the asset id in the path means an operator can find every video for a
 * machine by hand, without the database.
 */
export function buildRelativePath(assetId: string, token: string, fileName: string): string {
  return path.posix.join(assetId, token, fileName);
}

export function absolutePathFor(relativePath: string): string {
  const resolved = path.resolve(config.videoStorageDir, relativePath);

  // Defence in depth: a crafted relative path must never resolve outside the
  // storage root, even though the values come from our own database.
  const root = path.resolve(config.videoStorageDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Refusing to access a path outside the video storage root.');
  }
  return resolved;
}

export async function ensureStorageDir(): Promise<void> {
  await fsp.mkdir(config.videoStorageDir, { recursive: true });
}

/**
 * Streams a request body to disk.
 *
 * Aborts and cleans up if the payload exceeds MAX_VIDEO_MB - we cannot trust
 * Content-Length, so the limit is enforced on bytes actually written.
 */
export async function saveVideoStream(
  body: ReadableStream<Uint8Array>,
  relativePath: string,
  maxBytes: number = config.maxVideoBytes,
): Promise<{ bytesWritten: number }> {
  const absolute = absolutePathFor(relativePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });

  const writeStream = fs.createWriteStream(absolute);
  let bytesWritten = 0;

  try {
    const nodeStream = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);

    for await (const chunk of nodeStream) {
      const buf = chunk as Buffer;
      bytesWritten += buf.length;

      if (bytesWritten > maxBytes) {
        throw new VideoTooLargeError(maxBytes);
      }

      if (!writeStream.write(buf)) {
        // Respect backpressure so a fast uploader cannot balloon memory.
        await new Promise<void>((resolve, reject) => {
          writeStream.once('drain', resolve);
          writeStream.once('error', reject);
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    return { bytesWritten };
  } catch (error) {
    writeStream.destroy();
    await deleteQuietly(relativePath);
    throw error;
  }
}

export class VideoTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Video exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
    this.name = 'VideoTooLargeError';
  }
}

/** Removes a video and its now-empty token folder. Never throws. */
export async function deleteQuietly(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  try {
    const absolute = absolutePathFor(relativePath);
    await fsp.rm(absolute, { force: true });
    // The token directory holds exactly one file; drop it if it is now empty.
    await fsp.rmdir(path.dirname(absolute)).catch(() => {});
  } catch (error) {
    console.error('[video-storage] failed to delete', relativePath, error);
  }
}

export async function statVideo(
  relativePath: string,
): Promise<{ size: number; mtime: Date } | null> {
  try {
    const stats = await fsp.stat(absolutePathFor(relativePath));
    if (!stats.isFile()) return null;
    return { size: stats.size, mtime: stats.mtime };
  } catch {
    return null;
  }
}

/** Opens a byte range for HTTP Range responses (seeking / mobile playback). */
export function openVideoRange(
  relativePath: string,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  const absolute = absolutePathFor(relativePath);
  const nodeStream = fs.createReadStream(absolute, { start, end });
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

export function mimeForPath(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}
