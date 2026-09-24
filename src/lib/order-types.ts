import type { PurchaseOrderPhotoKind, PurchaseOrderStatus } from '@prisma/client';
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
  name: string;
  details: string | null;
  quantity: number;
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
  note: string | null;
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

/** A line's cost as bought, or null while any part of it is unknown. */
export function lineTotal(item: Pick<OrderItem, 'boughtUnitPrice' | 'quantity'>): number | null {
  return item.boughtUnitPrice === null ? null : item.boughtUnitPrice * item.quantity;
}
