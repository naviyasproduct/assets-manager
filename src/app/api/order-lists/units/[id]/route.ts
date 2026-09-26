import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { unitUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { listConflict } from '../../shared';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Renaming follows every line that uses it - that is the point of the table. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('purchasing', 'EDIT');
    const body = unitUpdateSchema.parse(await readJson(request));
    const unit = await prisma.unit.update({
      where: { id },
      data: body,
      include: { _count: { select: { items: true } } },
    });
    return ok({ unit });
  } catch (error) {
    return listConflict(error, 'name', 'That unit') ?? handleRouteError(error);
  }
}

/**
 * A unit in use is retired rather than deleted: the lines that carry it are
 * years of orders, and stripping the unit off them would turn "2.25 Kg" into
 * a bare 2.25 with nothing to say what it counts.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('purchasing', 'EDIT');

    const unit = await prisma.unit.findUnique({
      where: { id },
      select: { name: true, _count: { select: { items: true } } },
    });
    if (!unit) return fail('Unit not found.', 404);

    if (unit._count.items > 0) {
      const retired = await prisma.unit.update({ where: { id }, data: { isActive: false } });
      return ok({ unit: retired, deactivated: true });
    }

    await prisma.unit.delete({ where: { id } });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
