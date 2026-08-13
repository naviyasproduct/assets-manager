import { prisma } from '@/lib/db';
import { requireUser, assertDepartmentAccess } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import {
  isAllowedImageMime,
  buildImageRelativePath,
  saveImageStream,
  readImage,
  imageMimeFor,
  deleteImageQuietly,
  ImageTooLargeError,
  MAX_IMAGE_BYTES,
} from '@/lib/image-storage';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/assets/[id]/photo
 *
 * Serves the asset photo for the app's own tables and detail pages.
 *
 * Deliberately NOT under /videos/* - that prefix is what the Cloudflare Tunnel
 * exposes to the internet. Photos are internal data, so this route sits behind
 * the session and re-checks the department scope on every request.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const asset = await prisma.asset.findUnique({
      where: { id },
      select: {
        departmentId: true,
        photoRelativePath: true,
        photoMimeType: true,
        photoUploadedAt: true,
      },
    });

    if (!asset?.photoRelativePath) return fail('No photo for that asset.', 404);
    assertDepartmentAccess(user, asset.departmentId);

    const buffer = await readImage(asset.photoRelativePath);
    if (!buffer) return fail('The photo file is missing from disk.', 404);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': asset.photoMimeType ?? imageMimeFor(asset.photoRelativePath),
        'content-length': String(buffer.byteLength),
        // The filename carries a random suffix that changes on every upload, so
        // the response itself is safe to cache hard. `private` keeps it out of
        // any shared cache, since this is scoped internal data.
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PUT /api/assets/[id]/photo
 *
 * Raw request body is the image. The browser downscales before sending (see
 * downscaleImage in lib/client.ts), so this receives tens of kilobytes.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const asset = await prisma.asset.findUnique({
      where: { id },
      select: { departmentId: true, photoRelativePath: true },
    });
    if (!asset) return fail('Asset not found.', 404);
    assertDepartmentAccess(user, asset.departmentId);

    const mime = request.headers.get('content-type');
    if (!isAllowedImageMime(mime)) {
      return fail(
        `Unsupported image type${mime ? ` (${mime})` : ''}. Upload a JPEG, PNG or WEBP.`,
        415,
      );
    }

    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_IMAGE_BYTES) {
      return fail(`That image is larger than the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit.`, 413);
    }

    if (!request.body) return fail('No image was received.', 400);

    const previousPath = asset.photoRelativePath;
    const relativePath = buildImageRelativePath(id, mime!);

    let bytesWritten: number;
    try {
      ({ bytesWritten } = await saveImageStream(request.body, relativePath));
    } catch (error) {
      if (error instanceof ImageTooLargeError) return fail(error.message, 413);
      throw error;
    }

    if (bytesWritten === 0) return fail('The uploaded image was empty.', 400);

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        photoRelativePath: relativePath,
        photoOriginalName: request.headers.get('x-original-filename')?.slice(0, 120) ?? null,
        photoMimeType: mime!.split(';')[0].trim(),
        photoSizeBytes: bytesWritten,
        photoUploadedAt: new Date(),
      },
      select: { id: true, photoUploadedAt: true, photoSizeBytes: true },
    });

    // Replacing a photo: only bin the old file once the new one is committed.
    if (previousPath && previousPath !== relativePath) {
      await deleteImageQuietly(previousPath);
    }

    return ok({ asset: updated, sizeBytes: bytesWritten });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const asset = await prisma.asset.findUnique({
      where: { id },
      select: { departmentId: true, photoRelativePath: true },
    });
    if (!asset) return fail('Asset not found.', 404);
    assertDepartmentAccess(user, asset.departmentId);

    await prisma.asset.update({
      where: { id },
      data: {
        photoRelativePath: null,
        photoOriginalName: null,
        photoMimeType: null,
        photoSizeBytes: null,
        photoUploadedAt: null,
      },
    });

    await deleteImageQuietly(asset.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
