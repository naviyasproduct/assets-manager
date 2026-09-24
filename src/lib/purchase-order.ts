import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  AuthError,
  canAccessDepartment,
  departmentScopeFilter,
  seesAllDepartments,
  type SessionUser,
} from '@/lib/auth';
import { can, resolveAccess } from '@/lib/permissions';
import { NotFoundError } from '@/lib/api';
import { decimalToNumber } from '@/lib/serialize';
import {
  loadAssetCategoryOptions,
  loadDepartmentOptions,
  personPhotoUrl,
  toSupplierRow,
} from '@/lib/queries';
import type { OrderDetail } from '@/lib/order-types';

/**
 * Who may see and touch a purchase order. Every order route goes through these,
 * so the three rules live in one place:
 *
 *  - **See**: anyone assigned to it, whatever else they may open - being
 *    assigned is the whole of "assigned only" access. Beyond that, view access
 *    to purchasing shows every order in the departments the person sees.
 *  - **Manage** (edit the lines, the suppliers, who is assigned; delete; move
 *    it between tabs): edit access to purchasing, in that order's department.
 *  - **Work** (attach photos of what came back, enter what it cost, mark it
 *    completed): whoever may manage it, and whoever it is assigned to.
 */

export type OrderAccessFacts = { departmentId: string; assigneeIds: string[] };

/** The `where` that limits a list of orders to what this person may see. */
export function visibleOrdersWhere(user: SessionUser): Prisma.PurchaseOrderWhereInput {
  const assigned: Prisma.PurchaseOrderWhereInput = { assignees: { some: { userId: user.id } } };
  if (!can(user.access, 'purchasing', 'VIEW')) {
    return can(user.access, 'purchasing', 'ASSIGNED') ? assigned : { id: '__none__' };
  }
  if (seesAllDepartments(user)) return {};
  return { OR: [departmentScopeFilter(user), assigned] };
}

function isAssignee(user: SessionUser, order: OrderAccessFacts): boolean {
  return order.assigneeIds.includes(user.id);
}

export function canSeeOrder(user: SessionUser, order: OrderAccessFacts): boolean {
  if (isAssignee(user, order) && can(user.access, 'purchasing', 'ASSIGNED')) return true;
  return can(user.access, 'purchasing', 'VIEW') && canAccessDepartment(user, order.departmentId);
}

export function canManageOrder(user: SessionUser, order: OrderAccessFacts): boolean {
  return can(user.access, 'purchasing', 'EDIT') && canAccessDepartment(user, order.departmentId);
}

export function canWorkOrder(user: SessionUser, order: OrderAccessFacts): boolean {
  return (
    canManageOrder(user, order) ||
    (isAssignee(user, order) && can(user.access, 'purchasing', 'ASSIGNED'))
  );
}

/**
 * Loads just enough of an order to decide, and refuses the way the rest of
 * the app does: an order this person may not see is "not found", not
 * "forbidden", so its existence is not given away.
 */
export async function loadOrderFacts(
  id: string,
  user: SessionUser,
  need: 'see' | 'work' | 'manage',
) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      departmentId: true,
      assignees: { select: { userId: true } },
    },
  });

  const facts = order
    ? { departmentId: order.departmentId, assigneeIds: order.assignees.map((a) => a.userId) }
    : null;

  if (!order || !facts || !canSeeOrder(user, facts)) {
    throw new NotFoundError('Order not found.');
  }
  if (need === 'manage' && !canManageOrder(user, facts)) {
    throw new AuthError('Changing this order needs edit access to purchasing.', 403);
  }
  if (need === 'work' && !canWorkOrder(user, facts)) {
    throw new AuthError('Only the people assigned to this order can do that.', 403);
  }

  return { ...order, ...facts };
}

/**
 * The next PO number: PO-<year>-<4 digits>, counting within the year.
 *
 * Runs in the caller's transaction behind an advisory lock, the same way asset
 * tags are issued, so two orders saved at the same moment cannot share a
 * number. The unique index on PurchaseOrder.number is the backstop.
 */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  now = new Date(),
): Promise<string> {
  const prefix = `PO-${now.getFullYear()}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-number:${prefix}`}))`;

  const existing = await tx.purchaseOrder.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });

  const highest = existing.reduce((max, { number }) => {
    const n = Number(number.slice(prefix.length));
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);

  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

/** A schema-shaped refusal, so the message lands on the field that caused it. */
function fieldError(path: (string | number)[], message: string): never {
  throw new z.ZodError([{ code: z.ZodIssueCode.custom, path, message }]);
}

/**
 * The checks a foreign key cannot make about an order's contents:
 * every category is one of the order's department's, every picked asset is one
 * this person may see, every line's supplier is on the order, and everyone
 * assigned is an active account. Returns nothing; throws on the first problem.
 */
export async function assertOrderContents(
  user: SessionUser,
  input: {
    departmentId: string;
    supplierIds: string[];
    assigneeIds: string[];
    items: Array<{ categoryId?: string | null; basedOnAssetId?: string | null; supplierId?: string | null }>;
  },
) {
  const categoryIds = [...new Set(input.items.map((i) => i.categoryId).filter(Boolean))] as string[];
  const assetIds = [...new Set(input.items.map((i) => i.basedOnAssetId).filter(Boolean))] as string[];

  const [categories, assets, suppliers, people] = await Promise.all([
    categoryIds.length
      ? prisma.assetCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, departmentId: true },
        })
      : [],
    assetIds.length
      ? prisma.asset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, departmentId: true },
        })
      : [],
    input.supplierIds.length
      ? prisma.supplier.findMany({
          where: { id: { in: input.supplierIds } },
          select: { id: true },
        })
      : [],
    input.assigneeIds.length
      ? prisma.user.findMany({
          where: { id: { in: input.assigneeIds }, isActive: true },
          select: { id: true },
        })
      : [],
  ]);

  const categoryDept = new Map(categories.map((c) => [c.id, c.departmentId]));
  const assetDept = new Map(assets.map((a) => [a.id, a.departmentId]));
  const onOrder = new Set(input.supplierIds);

  input.items.forEach((item, index) => {
    if (item.categoryId && categoryDept.get(item.categoryId) !== input.departmentId) {
      fieldError(['items', index, 'categoryId'], "Pick one of this department's categories.");
    }
    if (item.basedOnAssetId) {
      const dept = assetDept.get(item.basedOnAssetId);
      if (!dept || !canAccessDepartment(user, dept)) {
        fieldError(['items', index, 'basedOnAssetId'], 'That asset is not one you can see.');
      }
    }
    if (item.supplierId && !onOrder.has(item.supplierId)) {
      fieldError(['items', index, 'supplierId'], 'Add that supplier to the order first.');
    }
  });

  if (suppliers.length !== input.supplierIds.length) {
    fieldError(['supplierIds'], 'One of those suppliers no longer exists.');
  }
  if (people.length !== input.assigneeIds.length) {
    fieldError(['assigneeIds'], 'One of those people is not an active employee.');
  }
}

// ---------------------------------------------------------------------------
// Reading an order out
// ---------------------------------------------------------------------------

const personSelect = {
  id: true,
  name: true,
  jobTitle: true,
  phone: true,
  photoRelativePath: true,
  photoUploadedAt: true,
} satisfies Prisma.UserSelect;

export const orderDetailInclude = {
  department: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  completedBy: { select: { name: true } },
  suppliers: { include: { supplier: true } },
  assignees: { include: { user: { select: personSelect } } },
  items: {
    orderBy: { position: 'asc' },
    include: {
      category: { select: { name: true } },
      basedOnAsset: {
        select: { assetTag: true, name: true, photoRelativePath: true, photoUploadedAt: true },
      },
      receivedAsset: { select: { assetTag: true } },
    },
  },
  photos: {
    orderBy: { createdAt: 'asc' },
    include: { uploadedBy: { select: { name: true } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

export type LoadedOrder = Prisma.PurchaseOrderGetPayload<{ include: typeof orderDetailInclude }>;

export function toOrderDetail(order: LoadedOrder, user: SessionUser): OrderDetail {
  const facts = {
    departmentId: order.departmentId,
    assigneeIds: order.assignees.map((a) => a.userId),
  };
  const manage = canManageOrder(user, facts);

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    note: order.note,
    departmentId: order.departmentId,
    departmentName: order.department.name,
    createdAt: order.createdAt.toISOString(),
    createdByName: order.createdBy.name,
    sentAt: order.sentAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
    completedByName: order.completedBy?.name ?? null,
    suppliers: order.suppliers
      .map(({ supplier }) => ({ ...toSupplierRow(supplier), isActive: supplier.isActive }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    assignees: order.assignees
      .map(({ user: person }) => ({
        id: person.id,
        name: person.name,
        jobTitle: person.jobTitle,
        phone: person.phone,
        photoUrl: personPhotoUrl(person),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    items: order.items.map((item) => {
      // The version stamp changes with whichever photo is actually served, so
      // a replaced one shows at once.
      const stamp = item.photoRelativePath
        ? item.photoUploadedAt?.getTime()
        : item.basedOnAsset?.photoRelativePath
          ? `a${item.basedOnAsset.photoUploadedAt?.getTime() ?? 0}`
          : null;
      return {
        id: item.id,
        position: item.position,
        name: item.name,
        details: item.details,
        quantity: item.quantity,
        categoryId: item.categoryId,
        categoryName: item.category?.name ?? null,
        basedOnAssetId: item.basedOnAssetId,
        basedOnAssetTag: item.basedOnAsset?.assetTag ?? null,
        basedOnAssetName: item.basedOnAsset?.name ?? null,
        supplierId: item.supplierId,
        photoUrl:
          stamp === null || stamp === undefined
            ? null
            : `/api/purchase-orders/${order.id}/items/${item.id}/photo?v=${stamp}`,
        hasOwnPhoto: Boolean(item.photoRelativePath),
        boughtUnitPrice: decimalToNumber(item.boughtUnitPrice),
        receivedAssetId: item.receivedAssetId,
        receivedAssetTag: item.receivedAsset?.assetTag ?? null,
      };
    }),
    photos: order.photos.map((photo) => ({
      id: photo.id,
      kind: photo.kind,
      url: `/api/purchase-orders/${order.id}/photos/${photo.id}`,
      uploadedByName: photo.uploadedBy?.name ?? null,
      createdAt: photo.createdAt.toISOString(),
    })),
    can: {
      manage,
      work: canWorkOrder(user, facts),
      // Turning lines into equipment writes assets, so it needs that access too.
      makeAssets:
        can(user.access, 'assets', 'EDIT') && canAccessDepartment(user, order.departmentId),
    },
  };
}

export async function loadOrderDetail(id: string, user: SessionUser): Promise<OrderDetail> {
  await loadOrderFacts(id, user, 'see');
  const order = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: orderDetailInclude,
  });
  return toOrderDetail(order, user);
}

// ---------------------------------------------------------------------------
// Writing an order's lines
// ---------------------------------------------------------------------------

type ItemInput = {
  id?: string | null;
  name: string;
  details?: string | null;
  quantity: number;
  categoryId?: string | null;
  basedOnAssetId?: string | null;
  supplierId?: string | null;
};

/**
 * Makes the order's lines exactly `items`, in that order. A line sent with its
 * id is updated in place - keeping its photo and anything bought against it -
 * one without is created, and one left out is deleted, unless it has already
 * become an asset: that line is the record of where the asset came from.
 *
 * Returns every line's id by position, so the browser can upload the photos it
 * is holding for lines that did not exist until now.
 */
export async function writeOrderItems(
  tx: Prisma.TransactionClient,
  orderId: string,
  items: ItemInput[],
): Promise<{ removedPhotos: string[]; ids: string[] }> {
  const existing = await tx.purchaseOrderItem.findMany({
    where: { orderId },
    select: { id: true, name: true, receivedAssetId: true, photoRelativePath: true },
  });
  const byId = new Map(existing.map((item) => [item.id, item]));
  const kept = new Set(items.map((item) => item.id).filter(Boolean));

  const removing = existing.filter((item) => !kept.has(item.id));
  const locked = removing.find((item) => item.receivedAssetId);
  if (locked) {
    fieldError(['items'], `"${locked.name}" has already been added to the assets, so it stays on the order.`);
  }
  if (removing.length > 0) {
    await tx.purchaseOrderItem.deleteMany({ where: { id: { in: removing.map((i) => i.id) } } });
  }

  const ids: string[] = [];
  for (const [position, item] of items.entries()) {
    const data = {
      position,
      name: item.name,
      details: item.details ?? null,
      quantity: item.quantity,
      categoryId: item.categoryId ?? null,
      basedOnAssetId: item.basedOnAssetId ?? null,
      supplierId: item.supplierId ?? null,
    };
    if (item.id) {
      if (!byId.has(item.id)) fieldError(['items', position], 'That line is not on this order.');
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data });
      ids.push(item.id);
    } else {
      const created = await tx.purchaseOrderItem.create({
        data: { ...data, orderId },
        select: { id: true },
      });
      ids.push(created.id);
    }
  }

  return {
    ids,
    removedPhotos: removing.map((i) => i.photoRelativePath).filter(Boolean) as string[],
  };
}

/** Duplicates in a posted id list would otherwise fail the unique join rows. */
export function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// What the order form picks from
// ---------------------------------------------------------------------------

/**
 * Everything the order form offers, scoped to this person. A supplier or a
 * person who has since been retired stays offered while the order being edited
 * already names them - otherwise opening an old order would quietly drop them.
 */
export async function loadOrderFormOptions(
  user: SessionUser,
  keep: { supplierIds?: string[]; assigneeIds?: string[] } = {},
) {
  const [departments, categories, assets, suppliers, people] = await Promise.all([
    loadDepartmentOptions(user),
    loadAssetCategoryOptions(user),
    prisma.asset.findMany({
      where: departmentScopeFilter(user),
      orderBy: [{ name: 'asc' }, { assetTag: 'asc' }],
      select: {
        id: true,
        assetTag: true,
        name: true,
        departmentId: true,
        status: true,
        quantity: true,
        category: { select: { id: true, name: true } },
        photoRelativePath: true,
        photoUploadedAt: true,
      },
    }),
    prisma.supplier.findMany({
      where: { OR: [{ isActive: true }, { id: { in: keep.supplierIds ?? [] } }] },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { OR: [{ isActive: true }, { id: { in: keep.assigneeIds ?? [] } }] },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        role: true,
        permissions: true,
        jobTitle: true,
        phone: true,
        photoRelativePath: true,
        photoUploadedAt: true,
      },
    }),
  ]);

  return {
    departments,
    categories,
    assets: assets.map((asset) => ({
      id: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      departmentId: asset.departmentId,
      categoryId: asset.category.id,
      categoryName: asset.category.name,
      status: asset.status,
      quantity: asset.quantity,
      photoUrl: asset.photoRelativePath
        ? `/api/assets/${asset.id}/photo?v=${asset.photoUploadedAt?.getTime() ?? 0}`
        : null,
    })),
    suppliers: suppliers.map((supplier) => ({
      ...toSupplierRow(supplier),
      isActive: supplier.isActive,
    })),
    // Only people who could open an order they are put on. Anyone with no
    // purchasing access at all would be assigned something they can never see.
    employees: people
      .filter(
        (person) =>
          can(resolveAccess(person.role, person.permissions), 'purchasing', 'ASSIGNED') ||
          keep.assigneeIds?.includes(person.id),
      )
      .map((person) => ({
        id: person.id,
        name: person.name,
        jobTitle: person.jobTitle,
        phone: person.phone,
        photoUrl: personPhotoUrl(person),
      })),
  };
}

export type OrderFormOptions = Awaited<ReturnType<typeof loadOrderFormOptions>>;
