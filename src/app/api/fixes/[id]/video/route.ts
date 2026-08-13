import { prisma } from '@/lib/db';
import { requireUser, assertDepartmentAccess } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { config, buildVideoWatchUrl } from '@/lib/config';
import {
  newVideoToken,
  sanitizeFileName,
  buildRelativePath,
  saveVideoStream,
  deleteQuietly,
  isAllowedVideoMime,
  VideoTooLargeError,
} from '@/lib/video-storage';

export const runtime = 'nodejs';
// Large uploads over the LAN can take a while; do not let the platform cut them.
export const maxDuration = 3600;

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/fixes/[id]/video?filename=repair.mp4
 *
 * Raw request body IS the video file - no multipart wrapper. The body streams
 * straight to the office PC's disk, so memory use stays flat regardless of file
 * size, and the browser can report real upload progress via XHR.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const fix = await prisma.machineFix.findUnique({
      where: { id },
      select: {
        videoRelativePath: true,
        assetId: true,
        asset: { select: { departmentId: true } },
      },
    });
    if (!fix) return fail('Fix record not found.', 404);
    assertDepartmentAccess(user, fix.asset.departmentId);

    const mime = request.headers.get('content-type');
    if (!isAllowedVideoMime(mime)) {
      return fail(
        `Unsupported file type${mime ? ` (${mime})` : ''}. Upload an MP4, MOV, MKV, WEBM or AVI video.`,
        415,
      );
    }

    // Reject obviously-oversized uploads before a single byte is transferred.
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > config.maxVideoBytes) {
      return fail(
        `That video is larger than the ${Math.round(config.maxVideoBytes / 1024 / 1024)} MB limit.`,
        413,
      );
    }

    if (!request.body) return fail('No file was received.', 400);

    const rawName = new URL(request.url).searchParams.get('filename') ?? 'repair-video';
    const fileName = sanitizeFileName(rawName, mime!);
    const token = newVideoToken();
    const relativePath = buildRelativePath(fix.assetId, token, fileName);

    const previousPath = fix.videoRelativePath;

    let bytesWritten: number;
    try {
      ({ bytesWritten } = await saveVideoStream(request.body, relativePath));
    } catch (error) {
      if (error instanceof VideoTooLargeError) {
        return fail(error.message, 413);
      }
      throw error;
    }

    if (bytesWritten === 0) {
      await deleteQuietly(relativePath);
      return fail('The uploaded file was empty.', 400);
    }

    const updated = await prisma.machineFix.update({
      where: { id },
      data: {
        videoToken: token,
        videoRelativePath: relativePath,
        videoOriginalName: fileName,
        videoMimeType: mime!.split(';')[0].trim(),
        videoSizeBytes: BigInt(bytesWritten),
        videoUploadedAt: new Date(),
      },
    });

    // Replacing a video: only bin the old file once the new one is committed.
    if (previousPath && previousPath !== relativePath) {
      await deleteQuietly(previousPath);
    }

    return ok({
      fix: updated,
      videoUrl: buildVideoWatchUrl(token),
      sizeBytes: bytesWritten,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** DELETE - remove the video but keep the written fix description. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const fix = await prisma.machineFix.findUnique({
      where: { id },
      select: {
        videoRelativePath: true,
        asset: { select: { departmentId: true } },
      },
    });
    if (!fix) return fail('Fix record not found.', 404);
    assertDepartmentAccess(user, fix.asset.departmentId);

    await prisma.machineFix.update({
      where: { id },
      data: {
        videoToken: null,
        videoRelativePath: null,
        videoOriginalName: null,
        videoMimeType: null,
        videoSizeBytes: null,
        videoUploadedAt: null,
      },
    });

    await deleteQuietly(fix.videoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
