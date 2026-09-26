import type { PurchaseOrderKind, PurchaseOrderPhotoKind, PurchaseOrderStatus } from '@prisma/client';
import type { SupplierRow } from '@/components/SupplierManager';

/**
 * What the Purchasing screens are handed for an order. Plain JSON, built by
 * `toOrderDetail` in purchase-order.ts; no `server-only` here because the
 * browser components are typed against it.
 */

export type OrderPerson = {
  id: string;
  name: string;
  jobTitle: string | null;
  phone: string | null;
  photoUrl: string | null;
};

export type OrderSupplier = Omit<SupplierRow, 'orderCount' | 'isActive'> & { isActive: boolean };

export type OrderItem = {
  id: string;
  position: number;
  /** The reference the paperwork quotes, if the line carries one. */
  codeNo: string | null;
  name: string;
  details: string | null;
  /** May be fractional: 2.25 Kg is a line like any other. */
  quantity: number;
  unitId: string | null;
  unitName: string | null;
  catalogueItemId: string | null;
  /** When this line turned up, which is often not when the order completed. */
  receivedDate: string | null;
  categoryId: string | null;
  categoryName: string | null;
  basedOnAssetId: string | null;
  basedOnAssetTag: string | null;
  basedOnAssetName: string | null;
  supplierId: string | null;
  /** The line's own photo, else the photo of the asset it was picked from. */
  photoUrl: string | null;
  hasOwnPhoto: boolean;
  boughtUnitPrice: number | null;
  receivedAssetId: string | null;
  receivedAssetTag: string | null;
};

export type OrderPhoto = {
  id: string;
  kind: PurchaseOrderPhotoKind;
  url: string;
  uploadedByName: string | null;
  createdAt: string;
};

export type OrderDetail = {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  kind: PurchaseOrderKind;
  note: string | null;

  /** Oversea orders only; null on a local one. */
  originFrom: string | null;
  attention: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;

  /** The four boxes at the foot of the paper order. Any may be empty. */
  requestedBy: OrderPerson | null;
  issuedBy: OrderPerson | null;
  checkedBy: OrderPerson | null;
  authorizedBy: OrderPerson | null;
  departmentId: string;
  departmentName: string;
  createdAt: string;
  createdByName: string;
  sentAt: string | null;
  completedAt: string | null;
  completedByName: string | null;
  suppliers: OrderSupplier[];
  assignees: OrderPerson[];
  items: OrderItem[];
  photos: OrderPhoto[];
  /** What the viewer may do - worked out on the server, only mirrored here. */
  can: { manage: boolean; work: boolean; makeAssets: boolean };
};

/**
 * A line's cost as bought, or null while any part of it is unknown. Rounded to
 * the cent: a unit price may carry four decimals ($0.625 each) and a quantity
 * three, and the product of the two is not money until it is rounded.
 */
export function lineTotal(item: Pick<OrderItem, 'boughtUnitPrice' | 'quantity'>): number | null {
  if (item.boughtUnitPrice === null) return null;
  return Math.round(item.boughtUnitPrice * item.quantity * 100) / 100;
}

/**
 * "12 PCS", "2.25 Kg", or just "12" when the line has no unit. Trailing zeros
 * are dropped - a quantity of 3.000 reads as 3.
 */
export function formatQuantity(
  item: Pick<OrderItem, 'quantity' | 'unitName'>,
): string {
  const amount = Number.isInteger(item.quantity)
    ? String(item.quantity)
    : String(Number(item.quantity.toFixed(3)));
  return item.unitName ? `${amount} ${item.unitName}` : amount;
}

/** The two order kinds, as they are written on screen. */
export const ORDER_KIND_LABELS: Record<PurchaseOrderKind, string> = {
  LOCAL: 'Local',
  OVERSEA: 'Oversea',
};

/** The four sign-off boxes, in the order they appear on the paper order. */
export const SIGN_OFF_ROLES = [
  { key: 'requestedBy', label: 'Requested by' },
  { key: 'issuedBy', label: 'Issued by' },
  { key: 'checkedBy', label: 'Checked by' },
  { key: 'authorizedBy', label: 'Authorized by' },
] as const;

export type SignOffKey = (typeof SIGN_OFF_ROLES)[number]['key'];
