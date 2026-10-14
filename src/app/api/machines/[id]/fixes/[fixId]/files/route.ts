import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { loadFixFacts } from '@/lib/machine';
import { buildFixFilePath, classifyFile } from '@/lib/machine-files';
import { VideoTooLargeError, deleteQuietly, saveVideoStream } from '@/lib/video-storage';

export const runtime = 'nodejs';
// A long video over the LAN can take a while; do not let the platform cut it.
export const maxDuration = 3600;

type Params = { params: Promise<{ id: string; fixId: string }> };

/**
 * POST ?name=<file name> - one file for a repair. The raw body is the file,
 * streamed straight to disk, so the browser can show real progress and memory
 * stays flat whatever the size. Video, photo or document is decided here.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, fixId } = await params;
    const user = await requireAccess('machines', 'EDIT');
    await loadFixFacts(id, fixId, user);

    const fileName = (new URL(request.url).searchParams.get('name') ?? '').trim().slice(0, 200);
    if (!fileName) return fail('The file has no name.', 400);

    const type = classifyFile(fileName, request.headers.get('content-type'));
    if (!type) {
      return fail('Attach a video (MP4, MOV…), a photo (JPG, PNG…) or a PDF, Word or Excel file.', 415);
    }
    const limitMb = Math.round(type.maxBytes / 1024 / 1024);
    if (Number(request.headers.get('content-length') ?? '0') > type.maxBytes) {
      return fail(`${fileName} is larger than the ${limitMb} MB limit.`, 413);
    }
    if (!request.body) return fail('No file was received.', 400);

    const { token, relativePath } = buildFixFilePath(id, fixId, fileName, type.kind);
    let bytes: number;
    try {
      bytes = (await saveVideoStream(request.body, relativePath, type.maxBytes)).bytesWritten;
    } catch (error) {
      if (error instanceof VideoTooLargeError) return fail(`${fileName} is larger than the ${limitMb} MB limit.`, 413);
      throw error;
    }
    if (bytes === 0) {
      await deleteQuietly(relativePath);
      return fail(`${fileName} was empty.`, 400);
    }

    try {
      const file = await prisma.machineFixFile.create({
        data: {
          fixId,
          kind: type.kind,
          fileName,
          relativePath,
          mimeType: type.mimeType,
          sizeBytes: BigInt(bytes),
          token,
          uploadedById: user.id,
        },
        select: { id: true, kind: true },
      });
      return ok({ file }, 201);
    } catch (error) {
      await deleteQuietly(relativePath);
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
