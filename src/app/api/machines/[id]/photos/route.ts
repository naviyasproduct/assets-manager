import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { machinePhotoOrderSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { buildImageRelativePath, deleteImageQuietly } from '@/lib/image-storage';
import { receiveImage } from '@/lib/image-upload';
import { loadMachineFacts } from '@/lib/machine';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Enough to show a machine from every side; the form sends them one at a time. */
const MAX_PHOTOS = 12;

/** POST - adds one photo at the end. Downscaled in the browser like every other photo here. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('machines', 'EDIT');
    await loadMachineFacts(id, user);

    const count = await prisma.machinePhoto.count({ where: { machineId: id } });
    if (count >= MAX_PHOTOS) return fail(`A machine can have up to ${MAX_PHOTOS} photos.`, 400);

    const received = await receiveImage(request, (mime) => buildImageRelativePath(id, mime, 'machines'));
    if (!received.ok) return received.response;

    try {
      const last = await prisma.machinePhoto.findFirst({
        where: { machineId: id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const photo = await prisma.machinePhoto.create({
        data: {
          machineId: id,
          relativePath: received.image.relativePath,
          mimeType: received.image.mime,
          position: (last?.position ?? -1) + 1,
        },
        select: { id: true },
      });
      return ok({ photo }, 201);
    } catch (error) {
      await deleteImageQuietly(received.image.relativePath);
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PUT - the photos in a new order; the first is the cover. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('machines', 'EDIT');
    const { order } = machinePhotoOrderSchema.parse(await readJson(request));
    await loadMachineFacts(id, user);

    const current = await prisma.machinePhoto.findMany({ where: { machineId: id }, select: { id: true } });
    const known = new Set(current.map((p) => p.id));
    if (order.length !== known.size || new Set(order).size !== order.length || order.some((p) => !known.has(p))) {
      return fail('The photos changed while you were arranging them. Reload and try again.', 409);
    }

    await prisma.$transaction(
      order.map((photoId, position) => prisma.machinePhoto.update({ where: { id: photoId }, data: { position } })),
    );
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
