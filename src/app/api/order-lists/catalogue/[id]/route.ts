import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { catalogueItemUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { listConflict } from '../../shared';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const detail = {
  descriptions: { select: { id: true, text: true }, orderBy: { text: 'asc' } },
  _count: { select: { orderItems: true } },
} as const;

/**
 * The descriptions are replaced wholesale when sent, which is how the form
 * works - a textarea, one per line. The name is copied onto an order line at
 * the time it is written, so renaming here never rewrites an order.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('purchasing', 'EDIT');
    const body = catalogueItemUpdateSchema.parse(await readJson(request));

    const item = await prisma.$transaction(async (tx) => {
      if (body.descriptions) {
        await tx.catalogueDescription.deleteMany({ where: { itemId: id } });
        await tx.catalogueDescription.createMany({
          data: [...new Set(body.descriptions)].map((text) => ({ itemId: id, text })),
        });
      }
      return tx.catalogueItem.update({
        where: { id },
        data: body.name ? { name: body.name } : {},
        include: detail,
      });
    });

    return ok({ item });
  } catch (error) {
    return listConflict(error, 'name', 'That item') ?? handleRouteError(error);
  }
}

/**
 * Deleting one leaves every order that used it untouched: the line keeps the
 * name it was written with and only loses the link back here. Said plainly
 * rather than blocked, because an entry typed wrong has to be removable.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('purchasing', 'EDIT');

    const item = await prisma.catalogueItem.findUnique({ where: { id }, select: { id: true } });
    if (!item) return fail('That catalogue entry no longer exists.', 404);

    await prisma.catalogueItem.delete({ where: { id } });
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
