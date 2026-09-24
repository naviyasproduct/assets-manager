import { prisma } from '@/lib/db';
import { requireUser, AuthError, type SessionUser } from '@/lib/auth';
import { ok, fail, handleRouteError } from '@/lib/api';
import { buildImageRelativePath, deleteImageQuietly } from '@/lib/image-storage';
import { receiveImage, imageResponse } from '@/lib/image-upload';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** An admin sets anyone's photo; everyone else only their own. */
function assertMayChange(user: SessionUser, id: string) {
  if (user.role !== 'ADMIN' && user.id !== id) {
    throw new AuthError('You can only change your own photo.', 403);
  }
}

/**
 * GET - open to anyone signed in. A face is how people are told apart on an
 * order they are assigned to, and an employee who may open nothing but their
 * own orders still has to see who they are working alongside.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireUser();

    const person = await prisma.user.findUnique({
      where: { id },
      select: { photoRelativePath: true, photoMimeType: true },
    });
    if (!person?.photoRelativePath) return fail('No photo for that person.', 404);

    return imageResponse(person.photoRelativePath, person.photoMimeType);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    assertMayChange(user, id);

    const person = await prisma.user.findUnique({
      where: { id },
      select: { photoRelativePath: true },
    });
    if (!person) return fail('Person not found.', 404);

    const received = await receiveImage(request, (mime) =>
      buildImageRelativePath(id, mime, 'people'),
    );
    if (!received.ok) return received.response;

    const updated = await prisma.user.update({
      where: { id },
      data: {
        photoRelativePath: received.image.relativePath,
        photoMimeType: received.image.mime,
        photoUploadedAt: new Date(),
      },
      select: { id: true, photoUploadedAt: true },
    });

    // Only bin the old file once the new one is committed.
    if (person.photoRelativePath) await deleteImageQuietly(person.photoRelativePath);

    return ok({ user: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    assertMayChange(user, id);

    const person = await prisma.user.findUnique({
      where: { id },
      select: { photoRelativePath: true },
    });
    if (!person) return fail('Person not found.', 404);

    await prisma.user.update({
      where: { id },
      data: { photoRelativePath: null, photoMimeType: null, photoUploadedAt: null },
    });
    await deleteImageQuietly(person.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
