import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { deleteImageQuietly } from '@/lib/image-storage';
import { imageResponse } from '@/lib/image-upload';
import { loadOrderFacts } from '@/lib/purchase-order';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; photoId: string }> };

async function findPhoto(orderId: string, photoId: string) {
  const photo = await prisma.purchaseOrderPhoto.findUnique({ where: { id: photoId } });
  // Scoped to the order in the URL, so access to one order never reaches
  // another order's photos by id.
  return photo && photo.orderId === orderId ? photo : null;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id, photoId } = await params;
    const user = await requireUser();
    await loadOrderFacts(id, user, 'see');

    const photo = await findPhoto(id, photoId);
    if (!photo) return fail('Photo not found.', 404);

    return imageResponse(photo.relativePath, photo.mimeType);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, photoId } = await params;
    const user = await requireUser();

    const photo = await findPhoto(id, photoId);
    if (!photo) {
      await loadOrderFacts(id, user, 'see');
      return fail('Photo not found.', 404);
    }
    // The same split as adding one: the sheet is the manager's, the rest the buyer's.
    await loadOrderFacts(id, user, photo.kind === 'SHEET' ? 'manage' : 'work');

    await prisma.purchaseOrderPhoto.delete({ where: { id: photoId } });
    await deleteImageQuietly(photo.relativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
