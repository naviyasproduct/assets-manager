import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { orderListOptionCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { listConflict } from '../shared';

export const runtime = 'nodejs';

/**
 * The four oversea dropdowns: From, Attention, Delivery and Payment. These are
 * suggestions, not a constraint - an order stores the words it was sent with,
 * so deleting an option here never rewrites an order that used it.
 */
export async function GET() {
  try {
    await requireAccess('purchasing', 'ASSIGNED');
    const options = await prisma.orderListOption.findMany({
      orderBy: [{ kind: 'asc' }, { isActive: 'desc' }, { sortOrder: 'asc' }, { value: 'asc' }],
    });
    return ok({ options });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAccess('purchasing', 'EDIT');
    const body = orderListOptionCreateSchema.parse(await readJson(request));
    const option = await prisma.orderListOption.create({ data: body });
    return ok({ option }, 201);
  } catch (error) {
    return listConflict(error, 'value', 'That entry') ?? handleRouteError(error);
  }
}
