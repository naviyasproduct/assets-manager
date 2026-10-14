-- CreateTable
CREATE TABLE "PurchaseOrderDocument" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderDocument_orderId_idx" ON "PurchaseOrderDocument"("orderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderDocument" ADD CONSTRAINT "PurchaseOrderDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDocument" ADD CONSTRAINT "PurchaseOrderDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The CRM import wrote three kinds of line into the note: the old stage, the
-- total recorded then, and a pointer to attachments left in the export folder.
-- The owner asked for them gone - the attachments now come in as documents.
-- Only those lines are removed ('n' makes ^ and $ match per line); anything a
-- person typed stays, and a note left empty becomes NULL.
UPDATE "PurchaseOrder"
SET "note" = NULLIF(
  btrim(
    regexp_replace(
      regexp_replace(
        "note",
        '^(Old stage: |Total recorded then: \$|Also had [0-9]+ attachment\(s\) that are not photos, kept in the ).*$',
        '',
        'gn'
      ),
      E'\n{2,}', E'\n', 'g'
    ),
    E' \n'
  ),
  ''
)
WHERE "note" ~ '(^|\n)(Old stage: |Total recorded then: \$|Also had [0-9]+ attachment\(s\) that are not photos, kept in the )';
