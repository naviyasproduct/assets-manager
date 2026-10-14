import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { machineFixSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { loadMachineFacts } from '@/lib/machine';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * POST - logs a repair as the machine's next version. The files go up after,
 * one request each, so a large video has its own progress bar and a failed
 * upload never loses the written record.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireAccess('machines', 'EDIT');
    const body = machineFixSchema.parse(await readJson(request));
    await loadMachineFacts(id, user);

    const fix = await prisma.$transaction(async (tx) => {
      // The increment is the lock: two repairs logged at once get v5 and v6.
      const machine = await tx.machine.update({
        where: { id },
        data: { lastVersion: { increment: 1 }, ...(body.statusAfter ? { status: body.statusAfter } : {}) },
        select: { lastVersion: true },
      });
      return tx.machineFix.create({
        data: {
          machineId: id,
          version: machine.lastVersion,
          title: body.title,
          symptom: body.symptom ?? null,
          description: body.description,
          fixedByName: body.fixedByName,
          fixedAt: body.fixedAt ?? new Date(),
          statusAfter: body.statusAfter ?? null,
          recordedById: user.id,
        },
        select: { id: true, version: true },
      });
    });

    return ok({ fix }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
