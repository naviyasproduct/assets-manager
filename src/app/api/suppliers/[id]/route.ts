import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { supplierUpdateSchema } from '@/lib/validation';
import { ok, fail, handleRouteError, readJson } from '@/lib/api';
import { deleteImageQuietly } from '@/lib/image-storage';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('suppliers', 'EDIT');
    const body = supplierUpdateSchema.parse(await readJson(request));

    const supplier = await prisma.supplier.update({ where: { id }, data: body });

    return ok({ supplier });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/suppliers/[id]
 *
 * A supplier that any order names is refused, and offered deactivation
 * instead (?mode=deactivate): an old order has to keep printing where it was
 * bought from. One nobody has used yet is simply removed.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireAccess('suppliers', 'EDIT');

    if (new URL(request.url).searchParams.get('mode') === 'deactivate') {
      const supplier = await prisma.supplier.update({
        where: { id },
        data: { isActive: false },
      });
      return ok({ supplier, deactivated: true });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      select: { photoRelativePath: true, _count: { select: { orders: true } } },
    });
    if (!supplier) return fail('Supplier not found.', 404);

    if (supplier._count.orders > 0) {
      return fail(
        `This supplier is on ${supplier._count.orders} order${supplier._count.orders === 1 ? '' : 's'}. Deactivate it instead, so those orders still show who they were bought from.`,
        409,
        { canDeactivate: 'true' },
      );
    }

    await prisma.supplier.delete({ where: { id } });
    await deleteImageQuietly(supplier.photoRelativePath);

    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
