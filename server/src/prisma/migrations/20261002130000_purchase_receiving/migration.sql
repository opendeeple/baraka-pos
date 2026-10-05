-- Purchase orders become a receiving workflow: an order waits until its
-- delivery is checked line by line and received into the shop or the
-- warehouse. The server puts the goods into stock once, on that transition.

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN "receivedLocation" TEXT,
ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "receiptId" TEXT;

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN "receivedQuantity" DECIMAL(12,2),
ADD COLUMN "discrepancyNote" TEXT;
