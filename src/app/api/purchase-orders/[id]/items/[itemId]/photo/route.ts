import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { buildImageRelativePath, deleteImageQuietly } from '@/lib/image-storage';
import { receiveImage, imageResponse } from '@/lib/image-upload';
import { loadOrderFacts } from '@/lib/purchase-order';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; itemId: string }> };

async function findItem(orderId: string, itemId: string) {
  const item = await prisma.purchaseOrderItem.findUnique({
    where: { id: itemId },
    select: {
      orderId: true,
      photoRelativePath: true,
      photoMimeType: true,
      basedOnAsset: { select: { photoRelativePath: true, photoMimeType: true } },
    },
  });
  return item && item.orderId === orderId ? item : null;
}

/**
 * GET - the line's own photo, or failing that the photo of the asset it was
 * picked from. Served through the order rather than /api/assets so that
 * someone who may see the order - an employee with no asset access at all -
 * still sees what they are meant to be buying.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id, itemId } = await params;
    const user = await requireUser();
    await loadOrderFacts(id, user, 'see');

    const item = await findItem(id, itemId);
    if (!item) return fail('Item not found.', 404);

    if (item.photoRelativePath) return imageResponse(item.photoRelativePath, item.photoMimeType);
    if (item.basedOnAsset?.photoRelativePath) {
      return imageResponse(item.basedOnAsset.photoRelativePath, item.basedOnAsset.photoMimeType);
    }
    return fail('No photo for that item.', 404);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id, itemId } = await params;
    const user = await requireUser();
    await loadOrderFacts(id, user, 'manage');

    const item = await findItem(id, itemId);
    if (!item) return fail('Item not found.', 404);

    const received = await receiveImage(request, (mime) =>
      buildImageRelativePath(id, mime, 'orders', `item-${itemId}`),
    );
    if (!received.ok) return received.response;

    await prisma.purchaseOrderItem.update({
      where: { id: itemId },
      data: {
        photoRelativePath: received.image.relativePath,
        photoMimeType: received.image.mime,
        photoUploadedAt: new Date(),
      },
    });
    if (item.photoRelativePath) await deleteImageQuietly(item.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, itemId } = await params;
    const user = await requireUser();
    await loadOrderFacts(id, user, 'manage');

    const item = await findItem(id, itemId);
    if (!item) return fail('Item not found.', 404);

    await prisma.purchaseOrderItem.update({
      where: { id: itemId },
      data: { photoRelativePath: null, photoMimeType: null, photoUploadedAt: null },
    });
    await deleteImageQuietly(item.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
