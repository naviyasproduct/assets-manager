-- Asset categories.
--
-- `Asset.category` was free text, so the same group was spelled three different
-- ways across a department and the asset tag could only ever be numbered per
-- department. Categories become real rows owned by a department, which gives
-- tags their middle segment (WRK-NUT-001) and a page where they can be managed.
--
-- Nothing is lost on the way: every distinct (department, category text) pair in
-- the existing data becomes an AssetCategory row, each asset is pointed at its
-- own, and only then is the text column dropped.

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetCategory_departmentId_idx" ON "AssetCategory"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_departmentId_name_key" ON "AssetCategory"("departmentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_departmentId_code_key" ON "AssetCategory"("departmentId", "code");

-- AddForeignKey
ALTER TABLE "AssetCategory" ADD CONSTRAINT "AssetCategory_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "categoryId" TEXT;

-- Backfill: one AssetCategory per distinct (department, category text).
DO $$
DECLARE
    pair      RECORD;
    base      TEXT;
    candidate TEXT;
    attempt   INT;
BEGIN
    FOR pair IN SELECT DISTINCT "departmentId", "category" FROM "Asset" LOOP
        -- Code = first three alphanumerics of the name, uppercased. A collision
        -- inside the same department gets a number, since the code has to stay
        -- unique there to keep asset tags unambiguous.
        base := upper(regexp_replace(pair."category", '[^a-zA-Z0-9]', '', 'g'));
        IF length(base) = 0 THEN
            base := 'CAT';
        END IF;
        base := substr(base, 1, 3);
        IF length(base) < 2 THEN
            base := rpad(base, 2, 'X');
        END IF;

        candidate := base;
        attempt := 1;
        WHILE EXISTS (
            SELECT 1 FROM "AssetCategory"
            WHERE "departmentId" = pair."departmentId" AND "code" = candidate
        ) LOOP
            attempt := attempt + 1;
            candidate := substr(base, 1, 2) || attempt::text;
        END LOOP;

        INSERT INTO "AssetCategory" ("id", "name", "code", "departmentId", "createdAt", "updatedAt")
        VALUES (
            'cat' || replace(gen_random_uuid()::text, '-', ''),
            pair."category",
            candidate,
            pair."departmentId",
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );
    END LOOP;
END $$;

UPDATE "Asset" a
SET "categoryId" = c."id"
FROM "AssetCategory" c
WHERE c."departmentId" = a."departmentId"
  AND c."name" = a."category";

-- Fails loudly rather than quietly orphaning an asset if the backfill missed one.
ALTER TABLE "Asset" ALTER COLUMN "categoryId" SET NOT NULL;

-- DropIndex
DROP INDEX "Asset_category_idx";

-- AlterTable
ALTER TABLE "Asset" DROP COLUMN "category";

-- CreateIndex
CREATE INDEX "Asset_categoryId_idx" ON "Asset"("categoryId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
