import 'server-only';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { MachineFixFileKind } from '@prisma/client';
import { config } from '@/lib/config';
import {
  MIME_BY_EXTENSION,
  absolutePathFor,
  isAllowedVideoMime,
  newVideoToken,
  openVideoRange,
  statVideo,
} from '@/lib/video-storage';
import { DOCUMENT_TYPES } from '@/lib/document-storage';

/**
 * Files attached to a repair: videos, photos and paperwork.
 *
 *   <VIDEO_STORAGE_DIR>/machines/<machineId>/<fixId>/<slug>/<name>.<ext>
 *
 * One folder per file, so two files of the same name never collide and the
 * whole history of a machine can be copied by hand. Everything streams to and
 * from disk - a repair video can be hundreds of megabytes - and photos are kept
 * as taken, not downscaled: a repair record wants the detail.
 */

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
};

export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export type FileType = { kind: MachineFixFileKind; mimeType: string; maxBytes: number };

/**
 * What kind of file this is. The extension decides, with the browser's type as
 * a fallback for videos - phones name files oddly, but report video types well.
 */
export function classifyFile(fileName: string, declaredMime: string | null): FileType | null {
  const ext = path.extname(fileName).toLowerCase();
  if (MIME_BY_EXTENSION[ext]) {
    return { kind: 'VIDEO', mimeType: MIME_BY_EXTENSION[ext], maxBytes: config.maxVideoBytes };
  }
  if (declaredMime && isAllowedVideoMime(declaredMime)) {
    return { kind: 'VIDEO', mimeType: declaredMime.split(';')[0].trim(), maxBytes: config.maxVideoBytes };
  }
  if (IMAGE_TYPES[ext]) return { kind: 'PHOTO', mimeType: IMAGE_TYPES[ext], maxBytes: MAX_PHOTO_BYTES };
  if (DOCUMENT_TYPES[ext]) {
    return { kind: 'DOCUMENT', mimeType: DOCUMENT_TYPES[ext], maxBytes: MAX_DOCUMENT_BYTES };
  }
  return null;
}

/** Videos get a token - their public link. Other files get a plain random folder. */
export function buildFixFilePath(machineId: string, fixId: string, fileName: string, kind: MachineFixFileKind) {
  const ext = path.extname(fileName).toLowerCase();
  const stem =
    path
      .basename(fileName, path.extname(fileName))
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .slice(0, 60) || kind.toLowerCase();
  const token = kind === 'VIDEO' ? newVideoToken() : null;
  const slug = token ?? crypto.randomBytes(8).toString('hex');
  return {
    token,
    relativePath: path.posix.join('machines', machineId, fixId, slug, `${stem}${ext}`),
  };
}

/** Removes a whole machine's folder, or one fix's, after its rows are gone. */
export async function deleteMachineFolder(machineId: string, fixId?: string): Promise<void> {
  try {
    const relative = fixId ? path.posix.join('machines', machineId, fixId) : path.posix.join('machines', machineId);
    await fsp.rm(absolutePathFor(relative), { recursive: true, force: true });
  } catch (error) {
    console.error('[machine-files] failed to delete folder', machineId, fixId, error);
  }
}

/**
 * Serves a stored file, honouring a byte range so a video can be scrubbed and
 * a phone can start playing before the whole file arrives.
 */
export async function fileResponse(
  request: Request,
  file: { relativePath: string; mimeType: string; fileName: string },
  disposition: 'inline' | 'attachment',
  cacheControl: string,
): Promise<Response> {
  const stats = await statVideo(file.relativePath);
  if (!stats) return new Response('The file is missing from disk.', { status: 404 });

  const size = stats.size;
  const ascii = file.fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const headers: Record<string, string> = {
    'content-type': file.mimeType,
    'accept-ranges': 'bytes',
    'content-disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  };

  const range = request.headers.get('range');
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!range) {
    return new Response(openVideoRange(file.relativePath, 0, size - 1), {
      status: 200,
      headers: { ...headers, 'content-length': String(size) },
    });
  }

  let start = NaN;
  let end = NaN;
  if (match) {
    const [, rawStart, rawEnd] = match;
    if (rawStart === '') {
      start = Math.max(0, size - Number(rawEnd));
      end = size - 1;
    } else {
      start = Number(rawStart);
      end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
    }
  }
  if (!match || !Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return new Response('Requested range not satisfiable', {
      status: 416,
      headers: { 'content-range': `bytes */${size}` },
    });
  }
  return new Response(openVideoRange(file.relativePath, start, end), {
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
  });
}
