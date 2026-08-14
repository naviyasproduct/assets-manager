import { Prisma } from '@prisma/client';
import { fail } from '@/lib/api';

/**
 * Turns the composite-unique clash on AssetCategory into something a person can
 * act on. The shared handler would otherwise say "That departmentId, name is
 * already in use", which reads like a bug report.
 */
export function assetCategoryConflict(error: unknown) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return null;
  }

  const target = (error.meta?.target as string[] | undefined) ?? [];

  if (target.includes('code')) {
    const message = 'Another category in this department already uses that code.';
    return fail(message, 409, { code: message });
  }

  if (target.includes('name')) {
    const message = 'This department already has a category with that name.';
    return fail(message, 409, { name: message });
  }

  return null;
}
