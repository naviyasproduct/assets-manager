import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { buildImageRelativePath, deleteImageQuietly } from '@/lib/image-storage';
import { receiveImage, imageResponse } from '@/lib/image-upload';
import { loadMachineFacts } from '@/lib/machine';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** The machine's profile picture - downscaled in the browser like every other photo here. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('machines', 'VIEW');
    await loadMachineFacts(id, user);

    const machine = await prisma.machine.findUniqueOrThrow({
      where: { id },
      select: { photoRelativePath: true, photoMimeType: true },
    });
    if (!machine.photoRelativePath) return fail('No photo for that machine.', 404);
    return imageResponse(machine.photoRelativePath, machine.photoMimeType);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('machines', 'EDIT');
    await loadMachineFacts(id, user);

    const before = await prisma.machine.findUniqueOrThrow({ where: { id }, select: { photoRelativePath: true } });
    const received = await receiveImage(request, (mime) => buildImageRelativePath(id, mime, 'machines'));
    if (!received.ok) return received.response;

    const machine = await prisma.machine.update({
      where: { id },
      data: {
        photoRelativePath: received.image.relativePath,
        photoMimeType: received.image.mime,
        photoUploadedAt: new Date(),
      },
      select: { id: true, photoUploadedAt: true },
    });
    if (before.photoRelativePath) await deleteImageQuietly(before.photoRelativePath);

    return ok({ machine });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('machines', 'EDIT');
    await loadMachineFacts(id, user);

    const before = await prisma.machine.findUniqueOrThrow({ where: { id }, select: { photoRelativePath: true } });
    await prisma.machine.update({
      where: { id },
      data: { photoRelativePath: null, photoMimeType: null, photoUploadedAt: null },
    });
    await deleteImageQuietly(before.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
