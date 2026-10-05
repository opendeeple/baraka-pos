-- Suppliers and shelf life: the expiry date written on a delivered line.

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN "expiryDate" TIMESTAMP(3);
