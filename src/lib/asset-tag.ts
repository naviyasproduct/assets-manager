import 'server-only';
import { Prisma } from '@prisma/client';
import { assetTagPrefix, highestTagNumber } from '@/lib/format';

/**
 * Generates the next asset tag for a category, e.g. WRK-NUT-001 -> WRK-NUT-004.
 *
 * The tag reads department code, then category code, then a number that counts
 * within that pair - so the label on the machine says what it is and who owns it
 * without anyone having to look it up. The numbering itself lives in
 * `highestTagNumber`, shared with the browser so the form can preview the tag an
 * asset is about to be given.
 *
 * Runs inside the caller's transaction and takes an advisory lock on the
 * category so two department heads adding an asset at the same moment over the
 * LAN cannot both claim the same number. The unique index on Asset.assetTag is
 * the final backstop.
 */
export async function nextAssetTag(
  tx: Prisma.TransactionClient,
  categoryId: string,
): Promise<string> {
  const category = await tx.assetCategory.findUnique({
    where: { id: categoryId },
    select: { code: true, department: { select: { code: true } } },
  });

  if (!category) {
    throw new Error('Category not found.');
  }

  // Postgres advisory lock keyed on the category, released at transaction end.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset-tag:${categoryId}`}))`;

  const prefix = assetTagPrefix(category.department.code, category.code);

  const existing = await tx.asset.findMany({
    where: { assetTag: { startsWith: prefix } },
    select: { assetTag: true },
  });

  const next = highestTagNumber(existing.map((asset) => asset.assetTag), prefix) + 1;

  return `${prefix}${String(next).padStart(3, '0')}`;
}
