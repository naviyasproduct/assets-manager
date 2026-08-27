import { prisma } from '@/lib/db';
import { requireUser, AuthError, type SessionUser } from '@/lib/auth';
import { reportPresetUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { presetConflict } from '../conflict';
import { REPORT_PRESET_SELECT } from '@/lib/queries';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * Saved reports are shared, so anyone may use one - but only the person who
 * saved it, or an admin, may change what everyone else gets.
 *
 * A preset whose author has since been deleted keeps working and becomes the
 * admin's to look after: the row survives the account on purpose.
 */
function assertMayEdit(user: SessionUser, createdById: string | null): void {
  if (user.role === 'ADMIN') return;
  if (createdById && createdById === user.id) return;
  throw new AuthError('Only the person who saved this report, or an administrator, can change it.', 403);
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const existing = await prisma.reportPreset.findUnique({
      where: { id },
      select: { createdById: true },
    });
    if (!existing) return fail('Saved report not found.', 404);

    assertMayEdit(user, existing.createdById);

    const body = reportPresetUpdateSchema.parse(await readJson(request));

    const preset = await prisma.reportPreset.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
      },
      select: REPORT_PRESET_SELECT,
    });

    return ok({ preset });
  } catch (error) {
    return presetConflict(error) ?? handleRouteError(error);
  }
}

/**
 * DELETE /api/report-presets/[id]
 *
 * A hard delete, unlike departments and locations: a saved report holds no
 * records of its own, so there is nothing to orphan and nothing to deactivate
 * around. The reports already generated from it are files on someone's disk and
 * are unaffected.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const existing = await prisma.reportPreset.findUnique({
      where: { id },
      select: { createdById: true },
    });
    if (!existing) return fail('Saved report not found.', 404);

    assertMayEdit(user, existing.createdById);

    await prisma.reportPreset.delete({ where: { id } });

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
