import 'server-only';
import { z } from 'zod';
import { prisma } from '@/lib/db';

/**
 * A category belongs to exactly one department, and so does the asset filed
 * under it - otherwise an asset tagged WRK-NUT-004 could sit in Printing.
 * A foreign key cannot express that, so every asset write checks it here.
 *
 * Throws the same shape a schema failure would, so the message lands on the
 * category field of the form rather than in a general error banner.
 */
export async function assertCategoryInDepartment(
  categoryId: string,
  departmentId: string,
): Promise<void> {
  const category = await prisma.assetCategory.findUnique({
    where: { id: categoryId },
    select: { departmentId: true },
  });

  const message = !category
    ? 'Choose a category for this asset.'
    : category.departmentId !== departmentId
      ? 'That category belongs to another department. Choose one from this department.'
      : null;

  if (!message) return;

  throw new z.ZodError([
    { code: z.ZodIssueCode.custom, path: ['categoryId'], message },
  ]);
}
