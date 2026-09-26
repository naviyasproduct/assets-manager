import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { unitCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { listConflict } from '../shared';

export const runtime = 'nodejs';

/**
 * The units an order line can be measured in - PCS, Kg, set. Site-wide, like
 * locations: a department head writing an order has to be able to say Kg, and
 * Kg is not theirs to own.
 */
export async function GET() {
  try {
    await requireAccess('purchasing', 'ASSIGNED');
    const units = await prisma.unit.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
    return ok({ units });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAccess('purchasing', 'EDIT');
    const body = unitCreateSchema.parse(await readJson(request));
    const unit = await prisma.unit.create({
      data: body,
      include: { _count: { select: { items: true } } },
    });
    return ok({ unit }, 201);
  } catch (error) {
    return listConflict(error, 'name', 'That unit') ?? handleRouteError(error);
  }
}
