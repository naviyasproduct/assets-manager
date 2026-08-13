-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "photoMimeType" TEXT,
ADD COLUMN     "photoOriginalName" TEXT,
ADD COLUMN     "photoRelativePath" TEXT,
ADD COLUMN     "photoSizeBytes" INTEGER,
ADD COLUMN     "photoUploadedAt" TIMESTAMP(3);

