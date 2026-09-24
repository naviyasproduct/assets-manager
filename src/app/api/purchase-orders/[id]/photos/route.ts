import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { buildImageRelativePath } from '@/lib/image-storage';
import { receiveImage } from '@/lib/image-upload';
import { loadOrderFacts } from '@/lib/purchase-order';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * POST ?kind=SHEET|RECEIVED - adds one photo to the order. The written list
 * is part of what the order *says*, so it takes someone who manages the order;
 * photos of what came back are the buyer's proof, so whoever is assigned may
 * add them too.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const kind = new URL(request.url).searchParams.get('kind');
    if (kind !== 'SHEET' && kind !== 'RECEIVED') {
      return fail('Say whether this is the order sheet or what was received.', 400);
    }
    await loadOrderFacts(id, user, kind === 'SHEET' ? 'manage' : 'work');

    const received = await receiveImage(request, (mime) =>
      buildImageRelativePath(id, mime, 'orders', kind === 'SHEET' ? 'sheet' : 'received'),
    );
    if (!received.ok) return received.response;

    const photo = await prisma.purchaseOrderPhoto.create({
      data: {
        orderId: id,
        kind,
        relativePath: received.image.relativePath,
        mimeType: received.image.mime,
        uploadedById: user.id,
      },
      select: { id: true, kind: true },
    });

    return ok({ photo }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
