-- Sync protocol v2 identity migration.
-- Every syncable row gets a globally-unique syncId (UUID). Tables may already
-- contain rows, so each column is added nullable, backfilled with
-- gen_random_uuid(), then constrained NOT NULL + UNIQUE.

-- AlterTable: syncId on syncable tables (nullable → backfill → NOT NULL)
ALTER TABLE "charges" ADD COLUMN "syncId" TEXT;
UPDATE "charges" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "charges" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "collections" ADD COLUMN "syncId" TEXT;
UPDATE "collections" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "collections" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "contacts" ADD COLUMN "syncId" TEXT;
UPDATE "contacts" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "contacts" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "expenses" ADD COLUMN "syncId" TEXT;
UPDATE "expenses" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "expenses" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "payment_transactions" ADD COLUMN "syncId" TEXT;
UPDATE "payment_transactions" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "payment_transactions" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "pos_sessions" ADD COLUMN "syncId" TEXT;
UPDATE "pos_sessions" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "pos_sessions" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "product_batches" ADD COLUMN "syncId" TEXT;
UPDATE "product_batches" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "product_batches" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "product_stocks" ADD COLUMN "syncId" TEXT;
UPDATE "product_stocks" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "product_stocks" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "products" ADD COLUMN "syncId" TEXT;
UPDATE "products" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "products" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "purchase_items" ADD COLUMN "syncId" TEXT;
UPDATE "purchase_items" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "purchase_items" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "purchases" ADD COLUMN "syncId" TEXT;
UPDATE "purchases" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "purchases" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "quantity_adjustments" ADD COLUMN "syncId" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "quantity_adjustments" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "quantity_adjustments" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "sale_items" ADD COLUMN "syncId" TEXT;
UPDATE "sale_items" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "sale_items" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "settings" ADD COLUMN "syncId" TEXT;
UPDATE "settings" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "settings" ALTER COLUMN "syncId" SET NOT NULL;

ALTER TABLE "users" ADD COLUMN "syncId" TEXT;
UPDATE "users" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "users" ALTER COLUMN "syncId" SET NOT NULL;

-- AlterTable: collection_product gains updatedAt for incremental pull
ALTER TABLE "collection_product" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: sales device attribution
ALTER TABLE "sales" ADD COLUMN "deviceId" INTEGER,
ADD COLUMN "localReference" TEXT;

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "syncId" TEXT NOT NULL,
    "storeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "registeredBy" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "lastPulledAt" TIMESTAMP(3),
    "invoiceRangeStart" INTEGER,
    "invoiceRangeEnd" INTEGER,
    "invoiceRangeNext" INTEGER,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_syncId_key" ON "devices"("syncId");
CREATE UNIQUE INDEX "charges_syncId_key" ON "charges"("syncId");
CREATE INDEX "charges_storeId_updatedAt_idx" ON "charges"("storeId", "updatedAt");
CREATE UNIQUE INDEX "collections_syncId_key" ON "collections"("syncId");
CREATE INDEX "collections_updatedAt_idx" ON "collections"("updatedAt");
CREATE UNIQUE INDEX "contacts_syncId_key" ON "contacts"("syncId");
CREATE INDEX "contacts_storeId_updatedAt_idx" ON "contacts"("storeId", "updatedAt");
CREATE UNIQUE INDEX "expenses_syncId_key" ON "expenses"("syncId");
CREATE INDEX "expenses_storeId_updatedAt_idx" ON "expenses"("storeId", "updatedAt");
CREATE UNIQUE INDEX "payment_transactions_syncId_key" ON "payment_transactions"("syncId");
CREATE UNIQUE INDEX "pos_sessions_syncId_key" ON "pos_sessions"("syncId");
CREATE INDEX "pos_sessions_storeId_updatedAt_idx" ON "pos_sessions"("storeId", "updatedAt");
CREATE UNIQUE INDEX "product_batches_syncId_key" ON "product_batches"("syncId");
CREATE INDEX "product_batches_updatedAt_idx" ON "product_batches"("updatedAt");
CREATE UNIQUE INDEX "product_stocks_syncId_key" ON "product_stocks"("syncId");
CREATE INDEX "product_stocks_storeId_updatedAt_idx" ON "product_stocks"("storeId", "updatedAt");
CREATE UNIQUE INDEX "products_syncId_key" ON "products"("syncId");
CREATE INDEX "products_storeId_updatedAt_idx" ON "products"("storeId", "updatedAt");
CREATE UNIQUE INDEX "purchase_items_syncId_key" ON "purchase_items"("syncId");
CREATE UNIQUE INDEX "purchases_syncId_key" ON "purchases"("syncId");
CREATE INDEX "purchases_storeId_updatedAt_idx" ON "purchases"("storeId", "updatedAt");
CREATE UNIQUE INDEX "quantity_adjustments_syncId_key" ON "quantity_adjustments"("syncId");
CREATE INDEX "quantity_adjustments_storeId_updatedAt_idx" ON "quantity_adjustments"("storeId", "updatedAt");
CREATE UNIQUE INDEX "sale_items_syncId_key" ON "sale_items"("syncId");
CREATE INDEX "sales_storeId_updatedAt_idx" ON "sales"("storeId", "updatedAt");
CREATE UNIQUE INDEX "settings_syncId_key" ON "settings"("syncId");
CREATE INDEX "settings_storeId_updatedAt_idx" ON "settings"("storeId", "updatedAt");
CREATE UNIQUE INDEX "users_syncId_key" ON "users"("syncId");
CREATE INDEX "users_storeId_updatedAt_idx" ON "users"("storeId", "updatedAt");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
