-- Assets carry the batch they came in; the list groups and labels by it.

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "batch" TEXT;

-- A group someone made by dragging becomes that group's batch, so nothing put
-- together by hand comes apart. The key was the name with its sizes taken out
-- ("drilling tool"); it becomes "Drilling tool". "own:<id>" meant "on its own
-- on purpose" and has no batch to become.
UPDATE "Asset"
SET "batch" = upper(left("listGroup", 1)) || substr("listGroup", 2)
WHERE "listGroup" IS NOT NULL AND "listGroup" NOT LIKE 'own:%';

-- AlterTable
ALTER TABLE "Asset" DROP COLUMN "listGroup";
