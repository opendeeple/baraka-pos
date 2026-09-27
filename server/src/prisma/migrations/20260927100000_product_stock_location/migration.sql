-- Warehouse module: product_stocks gains a `location` dimension ('shop' |
-- 'warehouse') so a product can carry separate on-hand quantities on the
-- shop floor vs in the warehouse. Every existing row is stamped 'shop' —
-- today's stock IS shop stock, so this moves/duplicates nothing.
ALTER TABLE "product_stocks" ADD COLUMN "location" TEXT NOT NULL DEFAULT 'shop';

DROP INDEX "product_stocks_storeId_productId_batchId_key";

CREATE UNIQUE INDEX "product_stocks_storeId_productId_batchId_location_key"
  ON "product_stocks"("storeId", "productId", "batchId", "location");

-- quantity_adjustments needs its own `location` for the same reason: it's
-- the only push vehicle for a client-side stock delta, so it has to say
-- which location's row the delta applies to.
ALTER TABLE "quantity_adjustments" ADD COLUMN "location" TEXT NOT NULL DEFAULT 'shop';
