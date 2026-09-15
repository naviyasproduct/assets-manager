-- AlterTable
-- Every existing row stands for exactly one unit, which is what the default
-- backfills. NOT NULL is safe for the same reason.
ALTER TABLE "Asset" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;
