-- Barcode badge login + employee attendance. Each employee's badge carries a
-- unique code; scanning it at a terminal opens a shift for that employee on
-- that terminal (see modules/shifts).
ALTER TABLE "users" ADD COLUMN "badgeCode" TEXT;

CREATE UNIQUE INDEX "users_badgeCode_key" ON "users"("badgeCode");

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_storeId_startedAt_idx" ON "shifts"("storeId", "startedAt");

-- CreateIndex
CREATE INDEX "shifts_userId_endedAt_idx" ON "shifts"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "shifts_deviceId_endedAt_idx" ON "shifts"("deviceId", "endedAt");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
