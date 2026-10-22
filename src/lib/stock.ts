import 'server-only';
import type { Prisma, StockMovementKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { departmentScopeFilter, type SessionUser } from '@/lib/auth';
import { sendMail } from '@/lib/mail';

/**
 * Stock: the assets someone chose to keep on hand and refill. The count is the
 * asset's own quantity - see StockItem in the schema - so this file only adds
 * the limit, the status that follows from it, and the alert.
 */

export type StockStatus = 'OK' | 'LOW' | 'OUT';

/** Empty is always worth a warning; otherwise "low" is strictly under the limit. */
export function stockStatus(quantity: number, minLevel: number): StockStatus {
  if (quantity <= 0) return 'OUT';
  if (quantity < minLevel) return 'LOW';
  return 'OK';
}

/**
 * Writes one line of a stocked asset's history. Every path that changes a
 * stocked count calls this - the stock routes, the asset form, an order
 * topping it up - so the history always adds up to what is on hand. An asset
 * not on the Stock page has no history; nothing is written for it.
 */
export async function logStockMovement(
  db: Prisma.TransactionClient,
  movement: {
    assetId: string;
    kind: StockMovementKind;
    change: number;
    quantityAfter: number;
    userId: string | null;
    note?: string | null;
  },
): Promise<void> {
  if (movement.kind !== 'START' && movement.change === 0) return;
  const stocked = await db.stockItem.findUnique({
    where: { assetId: movement.assetId },
    select: { id: true },
  });
  if (!stocked) return;
  await db.stockMovement.create({ data: { ...movement, note: movement.note ?? null } });
}

/** Items running low or out in the departments this person can see - the sidebar's red count. */
export async function lowStockCount(user: SessionUser): Promise<number> {
  const items = await prisma.stockItem.findMany({
    where: { asset: departmentScopeFilter(user) },
    select: { minLevel: true, asset: { select: { quantity: true } } },
  });
  return items.filter((item) => stockStatus(item.asset.quantity, item.minLevel) !== 'OK').length;
}

/**
 * Call after anything that changes a stocked asset's quantity or its limit.
 * Sends one email when the item first drops below its limit and remembers
 * that it did; once the count is back up the reminder is cleared, so the next
 * dip sends again. Never throws - a mail problem must not undo a stock change.
 */
export async function afterStockChange(assetId: string): Promise<void> {
  try {
    const item = await prisma.stockItem.findUnique({
      where: { assetId },
      include: {
        asset: {
          select: {
            name: true,
            assetTag: true,
            quantity: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    if (!item) return;

    const status = stockStatus(item.asset.quantity, item.minLevel);
    if (status === 'OK') {
      if (item.alertedAt) {
        await prisma.stockItem.update({ where: { id: item.id }, data: { alertedAt: null } });
      }
      return;
    }
    if (item.alertedAt) return;

    // Marked first, so two stock-outs a second apart cannot both send.
    const claimed = await prisma.stockItem.updateMany({
      where: { id: item.id, alertedAt: null },
      data: { alertedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const { asset } = item;
    const subject =
      status === 'OUT'
        ? `Out of stock: ${asset.name}`
        : `Running low: ${asset.name} (${asset.quantity} left)`;
    const text = [
      status === 'OUT'
        ? `${asset.name} (${asset.assetTag}) is out of stock.`
        : `${asset.name} (${asset.assetTag}) is down to ${asset.quantity}, below its limit of ${item.minLevel}.`,
      `Department: ${asset.department.name}`,
      '',
      `Stock page: ${config.lanBaseUrl}/stock`,
    ].join('\n');

    // Not sent (no SMTP yet, or the server refused) - give the claim back, so
    // the next change to this item tries again instead of staying silent.
    if (!(await sendMail(await alertRecipients(), subject, text))) {
      await prisma.stockItem.update({ where: { id: item.id }, data: { alertedAt: null } });
    }
  } catch (error) {
    console.error('[stock] alert check failed for', assetId, error);
  }
}

async function alertRecipients(): Promise<string[]> {
  const listed = config.mail.stockAlertTo
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (listed.length > 0) return listed;
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { email: true },
  });
  return admins.map((admin) => admin.email);
}
