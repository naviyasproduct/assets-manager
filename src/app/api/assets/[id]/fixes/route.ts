import { prisma } from '@/lib/db';
import { requireUser, assertDepartmentAccess } from '@/lib/auth';
import { fixCreateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** GET /api/assets/[id]/fixes - repair history, newest first. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const asset = await prisma.asset.findUnique({
      where: { id },
      select: { departmentId: true },
    });
    if (!asset) return fail('Asset not found.', 404);
    assertDepartmentAccess(user, asset.departmentId);

    const fixes = await prisma.machineFix.findMany({
      where: { assetId: id },
      orderBy: { fixedAt: 'desc' },
      include: { recordedBy: { select: { id: true, name: true } } },
    });

    return ok({ fixes });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/assets/[id]/fixes - record a repair.
 *
 * The video is NOT part of this request. The client creates the record first,
 * then streams the file to /api/fixes/[fixId]/video. Splitting it keeps a
 * multi-hundred-megabyte upload out of a JSON body and lets the UI show real
 * upload progress.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const body = fixCreateSchema.parse(await readJson(request));

    const asset = await prisma.asset.findUnique({
      where: { id },
      select: { departmentId: true },
    });
    if (!asset) return fail('Asset not found.', 404);
    assertDepartmentAccess(user, asset.departmentId);

    const fix = await prisma.machineFix.create({
      data: {
        assetId: id,
        title: body.title,
        description: body.description,
        fixedByName: body.fixedByName,
        symptom: body.symptom ?? null,
        fixedAt: body.fixedAt ?? new Date(),
        recordedById: user.id,
      },
      include: { recordedBy: { select: { id: true, name: true } } },
    });

    return ok({ fix }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
