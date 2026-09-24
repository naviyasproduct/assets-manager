-- Purchase needs become purchase orders, with suppliers of their own.
--
-- PurchaseRequest is dropped outright: it held no rows when this was written
-- (checked on 2026-09-22), and the owner asked for the old needs to go rather
-- than be converted. Generated with `prisma migrate diff` against the live
-- database, since `migrate dev` cannot create a shadow database here.

-- CreateEnum
CREATE TYPE "SupplierKind" AS ENUM ('LOCAL', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('NEW', 'PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PurchaseOrderPhotoKind" AS ENUM ('SHEET', 'RECEIVED');

-- DropForeignKey
ALTER TABLE "PurchaseRequest" DROP CONSTRAINT "PurchaseRequest_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseRequest" DROP CONSTRAINT "PurchaseRequest_replacesAssetId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseRequest" DROP CONSTRAINT "PurchaseRequest_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseRequest" DROP CONSTRAINT "PurchaseRequest_reviewedById_fkey";

-- DropTable
DROP TABLE "PurchaseRequest";

-- DropEnum
DROP TYPE "PurchaseKind";

-- DropEnum
DROP TYPE "PurchasePriority";

-- DropEnum
DROP TYPE "PurchaseStatus";

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SupplierKind" NOT NULL DEFAULT 'LOCAL',
    "contactPerson" TEXT,
    "phone" TEXT,
    "altPhone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "photoRelativePath" TEXT,
    "photoMimeType" TEXT,
    "photoUploadedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "departmentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderSupplier" (
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "PurchaseOrderSupplier_pkey" PRIMARY KEY ("orderId","supplierId")
);

-- CreateTable
CREATE TABLE "PurchaseOrderAssignee" (
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PurchaseOrderAssignee_pkey" PRIMARY KEY ("orderId","userId")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "categoryId" TEXT,
    "basedOnAssetId" TEXT,
    "supplierId" TEXT,
    "photoRelativePath" TEXT,
    "photoMimeType" TEXT,
    "photoUploadedAt" TIMESTAMP(3),
    "boughtUnitPrice" DECIMAL(12,2),
    "receivedAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderPhoto" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "PurchaseOrderPhotoKind" NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_kind_idx" ON "Supplier"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_departmentId_idx" ON "PurchaseOrder"("departmentId");

-- CreateIndex
CREATE INDEX "PurchaseOrderSupplier_supplierId_idx" ON "PurchaseOrderSupplier"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderAssignee_userId_idx" ON "PurchaseOrderAssignee"("userId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_orderId_idx" ON "PurchaseOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_categoryId_idx" ON "PurchaseOrderItem"("categoryId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_supplierId_idx" ON "PurchaseOrderItem"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_receivedAssetId_idx" ON "PurchaseOrderItem"("receivedAssetId");

-- CreateIndex
CREATE INDEX "PurchaseOrderPhoto_orderId_idx" ON "PurchaseOrderPhoto"("orderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderSupplier" ADD CONSTRAINT "PurchaseOrderSupplier_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderSupplier" ADD CONSTRAINT "PurchaseOrderSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderAssignee" ADD CONSTRAINT "PurchaseOrderAssignee_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderAssignee" ADD CONSTRAINT "PurchaseOrderAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_basedOnAssetId_fkey" FOREIGN KEY ("basedOnAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_receivedAssetId_fkey" FOREIGN KEY ("receivedAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderPhoto" ADD CONSTRAINT "PurchaseOrderPhoto_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderPhoto" ADD CONSTRAINT "PurchaseOrderPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

