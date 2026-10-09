-- Creditors ("haqdorlar"): money taken from customers, owed back by a due
-- date as money or goods, in UZS or USD. Synced both ways (sync v2 creditors).

-- CreateTable
CREATE TABLE "creditors" (
    "id" SERIAL NOT NULL,
    "syncId" TEXT NOT NULL,
    "storeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "returnType" TEXT NOT NULL DEFAULT 'money',
    "productNote" TEXT,
    "receivedAt" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "remindDays" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'open',
    "returnedAt" TEXT,
    "note" TEXT,
    "reminderSentAt" TEXT,
    "overdueSentAt" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "creditors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creditors_syncId_key" ON "creditors"("syncId");

-- CreateIndex
CREATE INDEX "creditors_storeId_updatedAt_idx" ON "creditors"("storeId", "updatedAt");

-- AddForeignKey
ALTER TABLE "creditors" ADD CONSTRAINT "creditors_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
