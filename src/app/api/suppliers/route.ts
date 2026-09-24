import { prisma } from '@/lib/db';
import { requireAccess, requireAnyAccess } from '@/lib/auth';
import { supplierCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * GET /api/suppliers. Readable with supplier access, and by anyone who takes
 * care of orders: the address and phone are what they go out with.
 */
export async function GET() {
  try {
    await requireAnyAccess([
      ['suppliers', 'VIEW'],
      ['purchasing', 'ASSIGNED'],
    ]);

    const suppliers = await prisma.supplier.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { orders: true } } },
    });

    return ok({ suppliers });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAccess('suppliers', 'EDIT');
    const body = supplierCreateSchema.parse(await readJson(request));

    const supplier = await prisma.supplier.create({ data: body });

    return ok({ supplier }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
