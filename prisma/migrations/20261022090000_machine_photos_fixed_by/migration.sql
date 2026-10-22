-- A machine can carry several profile pictures, and a repair names the
-- employee who did it.

-- CreateTable
CREATE TABLE "MachinePhoto" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachinePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachinePhoto_machineId_position_idx" ON "MachinePhoto"("machineId", "position");

-- AddForeignKey
ALTER TABLE "MachinePhoto" ADD CONSTRAINT "MachinePhoto_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The one photo each machine had becomes its first. The file stays where it
-- is; only the row that points at it moves. Timestamps are UTC, like every
-- other one Prisma writes (this database's own zone is Asia/Colombo).
INSERT INTO "MachinePhoto" ("id", "machineId", "relativePath", "mimeType", "position", "createdAt")
SELECT
    'mph' || substr(md5(random()::text || "id"), 1, 22),
    "id",
    "photoRelativePath",
    COALESCE("photoMimeType", 'image/jpeg'),
    0,
    COALESCE("photoUploadedAt", (now() AT TIME ZONE 'UTC'))
FROM "Machine"
WHERE "photoRelativePath" IS NOT NULL;

-- AlterTable
ALTER TABLE "Machine" DROP COLUMN "photoMimeType",
DROP COLUMN "photoRelativePath",
DROP COLUMN "photoUploadedAt";

-- AlterTable
ALTER TABLE "MachineFix" ADD COLUMN     "fixedById" TEXT;

-- AddForeignKey
ALTER TABLE "MachineFix" ADD CONSTRAINT "MachineFix_fixedById_fkey" FOREIGN KEY ("fixedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Repairs typed before the picker: link the name to an employee when it can
-- only mean one person ("prabath" and "Mr. Prabath"). Anything ambiguous or
-- unmatched keeps just the name it was typed with.
WITH names AS (
    SELECT "id",
           regexp_replace(lower(trim("name")), '^(mr|mrs|ms|miss|dr)\.?\s*', '') AS bare
    FROM "User"
),
unique_names AS (
    SELECT bare, min("id") AS "userId"
    FROM names
    GROUP BY bare
    HAVING count(*) = 1
)
UPDATE "MachineFix" f
SET "fixedById" = u."userId"
FROM unique_names u
WHERE u.bare = regexp_replace(lower(trim(f."fixedByName")), '^(mr|mrs|ms|miss|dr)\.?\s*', '');
