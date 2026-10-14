import 'server-only';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { imageAbsolutePathFor } from '@/lib/image-storage';

/**
 * Order paperwork that is not a photo - proformas, invoices, packing lists.
 *
 *   <VIDEO_STORAGE_DIR>/documents/orders/<orderId>/<name>-<suffix>.pdf
 *
 * Same storage root as the photos, so a backup still copies one folder. Unlike
 * a photo nothing downscales these in the browser, so the ceiling is higher and
 * the file is kept byte for byte.
 */

const DOCUMENTS_SUBDIR = 'documents';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** By extension, because browsers report Office files inconsistently or not at all. */
export const DOCUMENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function documentMimeFor(fileName: string): string | null {
  return DOCUMENT_TYPES[path.extname(fileName).toLowerCase()] ?? null;
}

export function buildDocumentRelativePath(orderId: string, fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  // Readable on disk, but never trusted as a path: anything odd becomes "-".
  const stem = path.basename(fileName, path.extname(fileName)).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'document';
  const suffix = crypto.randomBytes(6).toString('hex');
  return path.posix.join(DOCUMENTS_SUBDIR, 'orders', orderId, `${stem}-${suffix}${ext}`);
}

export class DocumentTooLargeError extends Error {
  constructor() {
    super(`The file is larger than the ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB limit.`);
    this.name = 'DocumentTooLargeError';
  }
}

export async function saveDocumentStream(
  body: ReadableStream<Uint8Array>,
  relativePath: string,
): Promise<{ bytesWritten: number }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError();
    chunks.push(buf);
  }
  if (total === 0) return { bytesWritten: 0 };

  const absolute = imageAbsolutePathFor(relativePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, Buffer.concat(chunks));
  return { bytesWritten: total };
}

export async function readDocument(relativePath: string): Promise<Buffer | null> {
  try {
    return await fsp.readFile(imageAbsolutePathFor(relativePath));
  } catch {
    return null;
  }
}

export async function deleteDocumentQuietly(relativePath: string): Promise<void> {
  try {
    const absolute = imageAbsolutePathFor(relativePath);
    await fsp.rm(absolute, { force: true });
    await fsp.rmdir(path.dirname(absolute)).catch(() => {});
  } catch (error) {
    console.error('[document-storage] failed to delete', relativePath, error);
  }
}
