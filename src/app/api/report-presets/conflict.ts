import { Prisma } from '@prisma/client';
import { fail } from '@/lib/api';

/**
 * Puts the duplicate-name message on the name field rather than in the general
 * banner. Names are unique case-insensitively - the same rule locations gained,
 * for the same reason: a shared list stops being useful the moment it holds
 * "Monthly CEO report" twice.
 */
export function presetConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }

  const message = 'A saved report with that name already exists.';
  return fail(message, 409, { name: message });
}
