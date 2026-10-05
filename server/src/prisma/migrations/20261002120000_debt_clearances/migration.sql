-- "Delete a paid-off debt" becomes a synced fact: a per-contact cut-off that
-- every device's debt history respects (rows newer than the latest clearedAt).
-- Sales and cash logs are never removed by it.

-- CreateTable
CREATE TABLE "debt_clearances" (
    "id" SERIAL NOT NULL,
    "syncId" TEXT NOT NULL,
    "storeId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "clearedAt" TIMESTAMP(3) NOT NULL,
    "totalDebt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debt_clearances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "debt_clearances_syncId_key" ON "debt_clearances"("syncId");

-- CreateIndex
CREATE INDEX "debt_clearances_storeId_updatedAt_idx" ON "debt_clearances"("storeId", "updatedAt");

-- CreateIndex
CREATE INDEX "debt_clearances_contactId_idx" ON "debt_clearances"("contactId");

-- CreateIndex: cash_logs are now pulled (customer repayments) by updatedAt cursor.
CREATE INDEX "cash_logs_storeId_updatedAt_idx" ON "cash_logs"("storeId", "updatedAt");

-- AddForeignKey
ALTER TABLE "debt_clearances" ADD CONSTRAINT "debt_clearances_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_clearances" ADD CONSTRAINT "debt_clearances_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Baseline: debts already paid off before this feature existed count as
-- cleared, so devices that now pull sales history don't list every customer
-- who ever bought on credit as "paid, waiting to be deleted".
-- timezone('UTC', now()), not CURRENT_TIMESTAMP: these columns hold UTC (as
-- Prisma writes them), and CURRENT_TIMESTAMP would store the session's local
-- wall time — in a +05 session, a cut-off 5 hours in the future that hides
-- any debt taken in those hours.
INSERT INTO "debt_clearances" ("syncId", "storeId", "contactId", "clearedAt", "updatedAt")
SELECT gen_random_uuid()::text, c."storeId", c."id", timezone('UTC', now()), timezone('UTC', now())
FROM "contacts" c
WHERE c."balance" <= 0
  AND EXISTS (
    SELECT 1 FROM "payment_transactions" pt
    WHERE pt."contactId" = c."id" AND pt."paymentMethod" = 'Debt'
  );
