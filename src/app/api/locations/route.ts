import { prisma } from '@/lib/db';
import { requireUser, requireAdmin, departmentScopeFilter } from '@/lib/auth';
import { locationCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { locationConflict } from './conflict';

export const runtime = 'nodejs';

/**
 * GET /api/locations
 *
 * The list itself is site-wide for everyone - a department head has to be able
 * to say their machine is in Shed B, and Shed B is not theirs to own. Only the
 * asset count is narrowed to what the caller may see, so the number under a
 * location matches the rows they would actually find in the assets table.
 */
export async function GET() {
  try {
    const user = await requireUser();

    const locations = await prisma.location.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { assets: { where: departmentScopeFilter(user) } } },
      },
    });

    return ok({ locations });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/locations - admin only, like departments. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = locationCreateSchema.parse(await readJson(request));

    const location = await prisma.location.create({
      data: body,
      include: { _count: { select: { assets: true } } },
    });

    return ok({ location }, 201);
  } catch (error) {
    return locationConflict(error) ?? handleRouteError(error);
  }
}
