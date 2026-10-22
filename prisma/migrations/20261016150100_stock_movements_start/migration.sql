-- Items already on the Stock page get a starting line with the count they have
-- now, so the history that follows adds up to what is on hand. History begins
-- today: nothing before this migration was ever recorded. The time is written
-- in UTC because that is how Prisma stores every other timestamp; a bare
-- CURRENT_TIMESTAMP is the server's local time and lands hours off.
INSERT INTO "StockMovement" ("id", "assetId", "kind", "change", "quantityAfter", "createdAt")
SELECT 'start_' || md5(s."assetId" || clock_timestamp()::text), s."assetId", 'START', 0, a."quantity", (now() AT TIME ZONE 'UTC')
FROM "StockItem" s
JOIN "Asset" a ON a."id" = s."assetId"
WHERE NOT EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."assetId" = s."assetId");
