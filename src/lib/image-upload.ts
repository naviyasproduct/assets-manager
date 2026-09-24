import 'server-only';
import type { NextResponse } from 'next/server';
import { fail } from '@/lib/api';
import {
  isAllowedImageMime,
  saveImageStream,
  readImage,
  imageMimeFor,
  ImageTooLargeError,
  MAX_IMAGE_BYTES,
} from '@/lib/image-storage';

/**
 * The receive-and-serve halves of a photo route, shared by people, suppliers
 * and purchase orders. Each of those routes still does its own authorisation
 * and its own database write - this only deals with bytes on disk. The asset
 * photo route predates it and is left as it was.
 */

export type ReceivedImage = { relativePath: string; mime: string; bytes: number };

/** Raw request body is the image, downscaled in the browser before sending. */
export async function receiveImage(
  request: Request,
  buildPath: (mime: string) => string,
): Promise<{ ok: true; image: ReceivedImage } | { ok: false; response: NextResponse }> {
  const mime = request.headers.get('content-type');
  if (!mime || !isAllowedImageMime(mime)) {
    return {
      ok: false,
      response: fail(
        `Unsupported image type${mime ? ` (${mime})` : ''}. Upload a JPEG, PNG or WEBP.`,
        415,
      ),
    };
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      response: fail(`That image is larger than the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit.`, 413),
    };
  }

  if (!request.body) return { ok: false, response: fail('No image was received.', 400) };

  const relativePath = buildPath(mime);
  try {
    const { bytesWritten } = await saveImageStream(request.body, relativePath);
    if (bytesWritten === 0) {
      return { ok: false, response: fail('The uploaded image was empty.', 400) };
    }
    return {
      ok: true,
      image: { relativePath, mime: mime.split(';')[0].trim(), bytes: bytesWritten },
    };
  } catch (error) {
    if (error instanceof ImageTooLargeError) {
      return { ok: false, response: fail(error.message, 413) };
    }
    throw error;
  }
}

/**
 * The file as a response. Every stored filename carries a random suffix that
 * changes on replacement, so it is safe to cache hard; `private` keeps it out
 * of any shared cache.
 */
export async function imageResponse(
  relativePath: string,
  mime: string | null,
): Promise<Response> {
  const buffer = await readImage(relativePath);
  if (!buffer) return fail('The photo file is missing from disk.', 404);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': mime ?? imageMimeFor(relativePath),
      'content-length': String(buffer.byteLength),
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
