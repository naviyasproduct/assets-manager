import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { reportPresetCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { presetConflict } from './conflict';
import { REPORT_PRESET_SELECT } from '@/lib/queries';

export const runtime = 'nodejs';

/**
 * GET /api/report-presets
 *
 * Everyone sees every saved report, department heads included. That is the
 * point of storing them in the database rather than the browser: a report the
 * CEO expects each month should look the same whoever generates it, and the
 * builder narrows a shared setup to the departments the person may actually see
 * before it runs.
 */
export async function GET() {
  try {
    await requireUser();

    const presets = await prisma.reportPreset.findMany({
      orderBy: { name: 'asc' },
      select: REPORT_PRESET_SELECT,
    });

    return ok({ presets });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/report-presets
 *
 * Not admin-only, unlike locations: a department head who has worked out how
 * they want their own equipment listed should be able to keep it. Editing and
 * deleting are what stay restricted, to the person who saved it or an admin.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = reportPresetCreateSchema.parse(await readJson(request));

    const preset = await prisma.reportPreset.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        config: body.config,
        createdById: user.id,
      },
      select: REPORT_PRESET_SELECT,
    });

    return ok({ preset }, 201);
  } catch (error) {
    return presetConflict(error) ?? handleRouteError(error);
  }
}
