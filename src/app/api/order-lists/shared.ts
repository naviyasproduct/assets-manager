import { Prisma } from '@prisma/client';
import { fail } from '@/lib/api';

/**
 * The three reference lists behind an order - units, the oversea dropdowns and
 * the item catalogue - are all unique by name, and a duplicate is the only
 * thing that realistically goes wrong when adding one. The message goes on the
 * field rather than in the banner, where the person is already looking.
 */
export function listConflict(error: unknown, field: string, what: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }
  const message = `${what} is already on the list.`;
  return fail(message, 409, { [field]: message });
}
