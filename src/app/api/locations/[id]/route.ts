import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { locationUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { locationConflict } from '../conflict';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/locations/[id]
 *
 * Renaming is safe: the name is only ever read through the relation, so every
 * asset standing there follows the new name automatically. That is the point of
 * the table - the old free-text column had to be edited row by row.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAdmin();
    const body = locationUpdateSchema.parse(await readJson(request));

    const location = await prisma.location.update({
      where: { id },
      data: body,
      include: { _count: { select: { assets: true } } },
    });

    return ok({ location });
  } catch (error) {
    return locationConflict(error) ?? handleRouteError(error);
  }
}

/**
 * DELETE /api/locations/[id]
 *
 * A location holding assets is never destroyed - the foreign key is Restrict, so
 * the attempt would fail anyway, but a bare constraint error tells nobody what
 * to do about it. ?mode=deactivate keeps the record and only hides the location
 * from the add-asset form, which is what "we do not use that bay any more"
 * actually means while machines are still standing in it.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAdmin();

    const location = await prisma.location.findUnique({
      where: { id },
      select: { name: true, _count: { select: { assets: true } } },
    });
    if (!location) return fail('Location not found.', 404);

    if (new URL(request.url).searchParams.get('mode') === 'deactivate') {
      const updated = await prisma.location.update({
        where: { id },
        data: { isActive: false },
      });
      return ok({ location: updated, deactivated: true });
    }

    if (location._count.assets > 0) {
      return fail(
        `${location.name} still holds ${location._count.assets} asset(s). Move them elsewhere first, or deactivate this location instead.`,
        409,
      );
    }

    await prisma.location.delete({ where: { id } });

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
