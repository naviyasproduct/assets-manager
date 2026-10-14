-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "minLevel" INTEGER NOT NULL DEFAULT 0,
    "alertedAt" TIMESTAMP(3),
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_assetId_key" ON "StockItem"("assetId");

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

