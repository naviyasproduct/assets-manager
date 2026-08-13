import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Generates the next asset tag for a department, e.g. PRT-001 -> PRT-004.
 *
 * Runs inside the caller's transaction and takes an advisory lock on the
 * department so two department heads adding an asset at the same moment over the
 * LAN cannot both claim the same number. The unique index on Asset.assetTag is
 * the final backstop.
 */
export async function nextAssetTag(
  tx: Prisma.TransactionClient,
  departmentId: string,
): Promise<string> {
  const department = await tx.department.findUnique({
    where: { id: departmentId },
    select: { code: true },
  });

  if (!department) {
    throw new Error('Department not found.');
  }

  // Postgres advisory lock keyed on the department, released at transaction end.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset-tag:${departmentId}`}))`;

  const prefix = `${department.code}-`;

  const existing = await tx.asset.findMany({
    where: { assetTag: { startsWith: prefix } },
    select: { assetTag: true },
  });

  let highest = 0;
  for (const { assetTag } of existing) {
    const suffix = assetTag.slice(prefix.length);
    // Ignore manually-entered tags that do not follow the numeric convention.
    if (/^\d+$/.test(suffix)) {
      highest = Math.max(highest, Number(suffix));
    }
  }

  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
