import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { orderListOptionUpdateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { listConflict } from '../../shared';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('purchasing', 'EDIT');
    const body = orderListOptionUpdateSchema.parse(await readJson(request));
    const option = await prisma.orderListOption.update({ where: { id }, data: body });
    return ok({ option });
  } catch (error) {
    return listConflict(error, 'value', 'That entry') ?? handleRouteError(error);
  }
}

/**
 * Deleting one is safe at any time. Nothing points at it: an order keeps the
 * text it was written with, not a reference to this row.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('purchasing', 'EDIT');
    await prisma.orderListOption.delete({ where: { id } });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
