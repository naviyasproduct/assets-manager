import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * A batch as it should be stored: tidied, and spelled the way the department
 * already spells it. "milling  drill" typed today joins "Milling drill" from
 * last month as that, so a batch is written one way however it was typed -
 * the list matches without regard to case, but a report or an export reads
 * the stored text.
 */
export async function canonicalBatch(
  db: PrismaClient | Prisma.TransactionClient,
  departmentId: string,
  batch: string | null | undefined,
): Promise<string | null> {
  const typed = batch?.trim().replace(/\s+/g, ' ');
  if (!typed) return null;
  const existing = await db.asset.findFirst({
    where: { departmentId, batch: { equals: typed, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { batch: true },
  });
  return existing?.batch ?? typed;
}
