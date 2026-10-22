import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { ok, handleRouteError, NotFoundError } from '@/lib/api';
import { deleteImageQuietly } from '@/lib/image-storage';
import { imageResponse } from '@/lib/image-upload';
import { loadMachineFacts } from '@/lib/machine';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; photoId: string }> };

/** One photo, checked to belong to the machine in the URL. */
async function loadPhoto(machineId: string, photoId: string) {
  const photo = await prisma.machinePhoto.findUnique({
    where: { id: photoId },
    select: { id: true, machineId: true, relativePath: true, mimeType: true },
  });
  if (!photo || photo.machineId !== machineId) throw new NotFoundError('Photo not found.');
  return photo;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id, photoId } = await params;
    const user = await requireAccess('machines', 'VIEW');
    await loadMachineFacts(id, user);
    const photo = await loadPhoto(id, photoId);
    return imageResponse(photo.relativePath, photo.mimeType);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, photoId } = await params;
    const user = await requireAccess('machines', 'EDIT');
    await loadMachineFacts(id, user);
    const photo = await loadPhoto(id, photoId);

    await prisma.machinePhoto.delete({ where: { id: photo.id } });
    await deleteImageQuietly(photo.relativePath);
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
