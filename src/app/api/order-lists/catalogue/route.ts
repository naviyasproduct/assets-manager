import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { catalogueItemCreateSchema } from '@/lib/validation';
import { ok, handleRouteError, readJson } from '@/lib/api';
import { listConflict } from '../shared';

export const runtime = 'nodejs';

/**
 * The things this factory buys, typed once and offered ever after, each with
 * the descriptions it comes in. A memory aid for writing an order - there is
 * no quantity and no price here, and nothing in it is stock.
 */
export async function GET() {
  try {
    await requireAccess('purchasing', 'ASSIGNED');
    const items = await prisma.catalogueItem.findMany({
      orderBy: { name: 'asc' },
      include: {
        descriptions: { select: { id: true, text: true }, orderBy: { text: 'asc' } },
        _count: { select: { orderItems: true } },
      },
    });
    return ok({ items });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAccess('purchasing', 'EDIT');
    const body = catalogueItemCreateSchema.parse(await readJson(request));

    const item = await prisma.catalogueItem.create({
      data: {
        name: body.name,
        // A description typed twice in the same box is one description.
        descriptions: { create: [...new Set(body.descriptions)].map((text) => ({ text })) },
      },
      include: {
        descriptions: { select: { id: true, text: true }, orderBy: { text: 'asc' } },
        _count: { select: { orderItems: true } },
      },
    });

    return ok({ item }, 201);
  } catch (error) {
    return listConflict(error, 'name', 'That item') ?? handleRouteError(error);
  }
}
