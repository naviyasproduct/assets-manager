-- Cost is now entered per unit, and a record's value is unitCost * quantity.
-- Until now purchaseCost held what the whole record cost, so dividing it by the
-- quantity preserves every figure. Rows with a quantity of 1 are untouched.
ALTER TABLE "Asset" RENAME COLUMN "purchaseCost" TO "unitCost";

UPDATE "Asset"
SET "unitCost" = ROUND("unitCost" / "quantity", 2)
WHERE "unitCost" IS NOT NULL AND "quantity" > 1;
