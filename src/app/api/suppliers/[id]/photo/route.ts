import { prisma } from '@/lib/db';
import { requireAccess, requireAnyAccess } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { buildImageRelativePath, deleteImageQuietly } from '@/lib/image-storage';
import { receiveImage, imageResponse } from '@/lib/image-upload';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Same readers as the supplier list: its logo sits beside it on every order. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAnyAccess([
      ['suppliers', 'VIEW'],
      ['purchasing', 'ASSIGNED'],
    ]);

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { photoRelativePath: true, photoMimeType: true },
    });
    if (!supplier?.photoRelativePath) return fail('No photo for that supplier.', 404);

    return imageResponse(supplier.photoRelativePath, supplier.photoMimeType);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('suppliers', 'EDIT');

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { photoRelativePath: true },
    });
    if (!supplier) return fail('Supplier not found.', 404);

    const received = await receiveImage(request, (mime) =>
      buildImageRelativePath(id, mime, 'suppliers'),
    );
    if (!received.ok) return received.response;

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        photoRelativePath: received.image.relativePath,
        photoMimeType: received.image.mime,
        photoUploadedAt: new Date(),
      },
      select: { id: true, photoUploadedAt: true },
    });

    if (supplier.photoRelativePath) await deleteImageQuietly(supplier.photoRelativePath);

    return ok({ supplier: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('suppliers', 'EDIT');

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { photoRelativePath: true },
    });
    if (!supplier) return fail('Supplier not found.', 404);

    await prisma.supplier.update({
      where: { id },
      data: { photoRelativePath: null, photoMimeType: null, photoUploadedAt: null },
    });
    await deleteImageQuietly(supplier.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
