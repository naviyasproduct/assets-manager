import { Prisma } from '@prisma/client';
import { fail } from '@/lib/api';

/**
 * Puts the duplicate-name message on the name field rather than in the general
 * error banner - the whole reason locations are admin-only is to keep one place
 * from being entered twice, so this is the message that gets seen most.
 */
export function locationConflict(error: unknown) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return null;
  }

  const message = 'A location with that name already exists.';
  return fail(message, 409, { name: message });
}
