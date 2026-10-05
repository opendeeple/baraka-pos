-- Box products sell loose pieces as a fraction of a box (1 of 30 pieces =
-- 0.0333), which DECIMAL(12,2) rounded to 0.03: sales reports came out ~10%
-- short and stock fell by 0.9 box per 30 pieces sold. Six decimal places
-- keep a single piece's amount within a so'm for any realistic box.
-- Widening never loses data; rows written before this stay as rounded.
ALTER TABLE "sale_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(18,6);
ALTER TABLE "sale_items" ALTER COLUMN "freeQuantity" SET DATA TYPE DECIMAL(18,6);
ALTER TABLE "product_stocks" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(18,6);
ALTER TABLE "quantity_adjustments" ALTER COLUMN "previousQuantity" SET DATA TYPE DECIMAL(18,6);
ALTER TABLE "quantity_adjustments" ALTER COLUMN "adjustedQuantity" SET DATA TYPE DECIMAL(18,6);
