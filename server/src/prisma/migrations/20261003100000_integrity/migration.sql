-- Integrity round: how a cash movement was paid, which document moved stock,
-- and an audit trail of sensitive actions.

-- AlterTable
ALTER TABLE "cash_logs" ADD COLUMN "paymentMethod" TEXT;

-- AlterTable
ALTER TABLE "quantity_adjustments" ADD COLUMN "kind" TEXT;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "syncId" TEXT NOT NULL,
    "storeId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "userId" INTEGER,
    "userName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_syncId_key" ON "audit_logs"("syncId");

-- CreateIndex
CREATE INDEX "audit_logs_storeId_updatedAt_idx" ON "audit_logs"("storeId", "updatedAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
