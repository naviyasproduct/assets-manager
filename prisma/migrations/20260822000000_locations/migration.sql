-- Locations.
--
-- `Asset.location` was free text, so the same physical place was spelled several
-- ways ("Print floor, bay 1" / "print floor bay 1") and nothing could be counted
-- or filtered by where it actually stands. Locations become real rows.
--
-- Unlike AssetCategory these are NOT owned by a department: one shed is one shed
-- regardless of whose machine is in it, and the same floor holds equipment from
-- several departments at once.
--
-- Nothing is lost on the way: every distinct free-text value becomes a Location,
-- each asset is pointed at its own, and only then is the text column dropped.

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "locationId" TEXT;

-- Backfill: one Location per distinct free-text value.
--
-- Grouped case-insensitively, because "Server cupboard" and "server cupboard"
-- are the same cupboard and the new column is uniquely indexed. Where a place
-- was spelled more than one way, the spelling used on the most assets wins, with
-- alphabetical order as a tie-break so re-running this cannot produce a
-- different answer.
WITH spellings AS (
    SELECT
        btrim("location")        AS name,
        lower(btrim("location")) AS key,
        count(*)                 AS uses
    FROM "Asset"
    WHERE "location" IS NOT NULL AND btrim("location") <> ''
    GROUP BY 1, 2
),
chosen AS (
    SELECT DISTINCT ON (key) name
    FROM spellings
    ORDER BY key, uses DESC, name ASC
)
INSERT INTO "Location" ("id", "name", "createdAt", "updatedAt")
SELECT
    'loc' || replace(gen_random_uuid()::text, '-', ''),
    name,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM chosen;

UPDATE "Asset" a
SET "locationId" = l."id"
FROM "Location" l
WHERE a."location" IS NOT NULL
  AND btrim(a."location") <> ''
  AND lower(l."name") = lower(btrim(a."location"));

-- Guard: every asset that had a location text must now point at a row. Left as a
-- hard failure rather than a silent data loss - the transaction rolls back and
-- the old column is still there to look at.
DO $$
DECLARE
    orphans INT;
BEGIN
    SELECT count(*) INTO orphans
    FROM "Asset"
    WHERE "location" IS NOT NULL
      AND btrim("location") <> ''
      AND "locationId" IS NULL;

    IF orphans > 0 THEN
        RAISE EXCEPTION 'Location backfill missed % asset(s); not dropping the text column.', orphans;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "Asset" DROP COLUMN "location";

-- CreateIndex
CREATE INDEX "Asset_locationId_idx" ON "Asset"("locationId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
