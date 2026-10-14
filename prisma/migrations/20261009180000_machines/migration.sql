-- Repairs move from assets to the new Machine records, and the old one-video
-- columns go. Written when no repair had ever been recorded; if one has, stop
-- here rather than drop it - those rows need a machine to belong to first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MachineFix") THEN
    RAISE EXCEPTION 'MachineFix has rows. Move them to machines by hand before applying 20261009180000_machines.';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('RUNNING', 'UNDER_REPAIR', 'STOPPED');

-- CreateEnum
CREATE TYPE "MachineFixFileKind" AS ENUM ('VIDEO', 'PHOTO', 'DOCUMENT');

-- DropForeignKey
ALTER TABLE "MachineFix" DROP CONSTRAINT "MachineFix_assetId_fkey";

-- DropIndex
DROP INDEX "MachineFix_assetId_idx";

-- DropIndex
DROP INDEX "MachineFix_videoToken_key";

-- AlterTable
ALTER TABLE "MachineFix" DROP COLUMN "assetId",
DROP COLUMN "videoMimeType",
DROP COLUMN "videoOriginalName",
DROP COLUMN "videoRelativePath",
DROP COLUMN "videoSizeBytes",
DROP COLUMN "videoToken",
DROP COLUMN "videoUploadedAt",
ADD COLUMN     "machineId" TEXT NOT NULL,
ADD COLUMN     "statusAfter" "MachineStatus",
ADD COLUMN     "version" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "manufacturer" TEXT,
    "serialNumber" TEXT,
    "status" "MachineStatus" NOT NULL DEFAULT 'RUNNING',
    "installedAt" TIMESTAMP(3),
    "notes" TEXT,
    "departmentId" TEXT NOT NULL,
    "locationId" TEXT,
    "photoRelativePath" TEXT,
    "photoMimeType" TEXT,
    "photoUploadedAt" TIMESTAMP(3),
    "lastVersion" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineFixFile" (
    "id" TEXT NOT NULL,
    "fixId" TEXT NOT NULL,
    "kind" "MachineFixFileKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "token" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineFixFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Machine_code_key" ON "Machine"("code");

-- CreateIndex
CREATE INDEX "Machine_departmentId_idx" ON "Machine"("departmentId");

-- CreateIndex
CREATE INDEX "Machine_status_idx" ON "Machine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MachineFixFile_token_key" ON "MachineFixFile"("token");

-- CreateIndex
CREATE INDEX "MachineFixFile_fixId_idx" ON "MachineFixFile"("fixId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineFix_machineId_version_key" ON "MachineFix"("machineId", "version");

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineFix" ADD CONSTRAINT "MachineFix_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineFixFile" ADD CONSTRAINT "MachineFixFile_fixId_fkey" FOREIGN KEY ("fixId") REFERENCES "MachineFix"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineFixFile" ADD CONSTRAINT "MachineFixFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

