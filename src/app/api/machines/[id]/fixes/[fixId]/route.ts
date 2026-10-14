import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { machineFixUpdateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { loadFixFacts } from '@/lib/machine';
import { deleteMachineFolder } from '@/lib/machine-files';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; fixId: string }> };

/** PATCH - corrects the write-up. The version number never changes. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, fixId } = await params;
    const user = await requireAccess('machines', 'EDIT');
    const body = machineFixUpdateSchema.parse(await readJson(request));
    const fix = await loadFixFacts(id, fixId, user);

    await prisma.$transaction(async (tx) => {
      // A repair always has a date, so a cleared date field leaves it as it was.
      await tx.machineFix.update({ where: { id: fixId }, data: { ...body, fixedAt: body.fixedAt ?? undefined } });
      // Only the newest repair speaks for how the machine is now.
      if (body.statusAfter) {
        const machine = await tx.machine.findUniqueOrThrow({ where: { id }, select: { lastVersion: true } });
        if (machine.lastVersion === fix.version) {
          await tx.machine.update({ where: { id }, data: { status: body.statusAfter } });
        }
      }
    });

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE - removes a repair and its files. Its number is not handed out again,
 * so the history shows a gap rather than two different v4s.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id, fixId } = await params;
    const user = await requireAccess('machines', 'EDIT');
    await loadFixFacts(id, fixId, user);

    await prisma.machineFix.delete({ where: { id: fixId } });
    await deleteMachineFolder(id, fixId);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
