-- Box/kg unit pricing: how many pieces one box contains, only meaningful
-- when Product.unit = 'box' (a 'kg' product's existing price already means
-- "price per kg", nothing extra needed for that case).
ALTER TABLE "products" ADD COLUMN "unitsPerPackage" DECIMAL(12,2);
