import { prisma } from '@/lib/db';
import { requireUser, assertDepartmentAccess } from '@/lib/auth';
import { fixUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { deleteQuietly } from '@/lib/video-storage';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const body = fixUpdateSchema.parse(await readJson(request));

    const fix = await prisma.machineFix.findUnique({
      where: { id },
      select: { asset: { select: { departmentId: true } } },
    });
    if (!fix) return fail('Fix record not found.', 404);
    assertDepartmentAccess(user, fix.asset.departmentId);

    const updated = await prisma.machineFix.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.fixedByName !== undefined ? { fixedByName: body.fixedByName } : {}),
        ...(body.symptom !== undefined ? { symptom: body.symptom } : {}),
        ...(body.fixedAt !== undefined && body.fixedAt !== null
          ? { fixedAt: body.fixedAt }
          : {}),
      },
      include: { recordedBy: { select: { id: true, name: true } } },
    });

    return ok({ fix: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const fix = await prisma.machineFix.findUnique({
      where: { id },
      select: {
        videoRelativePath: true,
        asset: { select: { departmentId: true } },
      },
    });
    if (!fix) return fail('Fix record not found.', 404);
    assertDepartmentAccess(user, fix.asset.departmentId);

    await prisma.machineFix.delete({ where: { id } });
    // Only after the row is gone, so a failed delete never leaves a dangling
    // database record pointing at a missing file.
    await deleteQuietly(fix.videoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
