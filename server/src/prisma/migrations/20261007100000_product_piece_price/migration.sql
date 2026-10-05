-- A box product's own per-piece price. Null keeps the old rule (box price ÷
-- unitsPerPackage); set, loose pieces sell at it while whole boxes still sell
-- at the box price.
ALTER TABLE "products" ADD COLUMN "piecePrice" DECIMAL(12,2);
