-- CreateEnum
CREATE TYPE "OrderListKind" AS ENUM ('FROM', 'ATTENTION', 'DELIVERY', 'PAYMENT');

-- CreateEnum
CREATE TYPE "PurchaseOrderKind" AS ENUM ('LOCAL', 'OVERSEA');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "attention" TEXT,
ADD COLUMN     "authorizedById" TEXT,
ADD COLUMN     "checkedById" TEXT,
ADD COLUMN     "deliveryTerms" TEXT,
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "kind" "PurchaseOrderKind" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "originFrom" TEXT,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "requestedById" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "catalogueItemId" TEXT,
ADD COLUMN     "codeNo" TEXT,
ADD COLUMN     "receivedDate" TIMESTAMP(3),
ADD COLUMN     "unitId" TEXT,
ALTER COLUMN "quantity" SET DEFAULT 1,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3),
ALTER COLUMN "boughtUnitPrice" SET DATA TYPE DECIMAL(12,4);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderListOption" (
    "id" TEXT NOT NULL,
    "kind" "OrderListKind" NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderListOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueDescription" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "CatalogueDescription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_name_key" ON "Unit"("name");

-- CreateIndex
CREATE INDEX "OrderListOption_kind_idx" ON "OrderListOption"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "OrderListOption_kind_value_key" ON "OrderListOption"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueItem_name_key" ON "CatalogueItem"("name");

-- CreateIndex
CREATE INDEX "CatalogueDescription_itemId_idx" ON "CatalogueDescription"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueDescription_itemId_text_key" ON "CatalogueDescription"("itemId", "text");

-- CreateIndex
CREATE INDEX "PurchaseOrder_kind_idx" ON "PurchaseOrder"("kind");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_unitId_idx" ON "PurchaseOrderItem"("unitId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_catalogueItemId_idx" ON "PurchaseOrderItem"("catalogueItemId");

-- AddForeignKey
ALTER TABLE "CatalogueDescription" ADD CONSTRAINT "CatalogueDescription_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_catalogueItemId_fkey" FOREIGN KEY ("catalogueItemId") REFERENCES "CatalogueItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

