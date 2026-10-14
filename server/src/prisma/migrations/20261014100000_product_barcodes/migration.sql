-- Extra barcodes a product also answers to (an older batch's packaging, a
-- supplier's own code, or an auto-generated one), alongside its primary
-- products.barcode. Synced both ways (sync v2 product_barcodes).

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" SERIAL NOT NULL,
    "syncId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "barcode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_syncId_key" ON "product_barcodes"("syncId");

-- CreateIndex
CREATE INDEX "product_barcodes_updatedAt_idx" ON "product_barcodes"("updatedAt");

-- CreateIndex
CREATE INDEX "product_barcodes_barcode_idx" ON "product_barcodes"("barcode");

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
