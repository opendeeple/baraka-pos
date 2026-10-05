-- Device keys are gone: terminals sync and run badge shifts with a terminal
-- token (a user JWT), and a shift names its terminal by the terminal's own
-- name instead of a registered device row. Old shifts keep their deviceId.
ALTER TABLE "shifts" ALTER COLUMN "deviceId" DROP NOT NULL;
ALTER TABLE "shifts" ADD COLUMN "terminalName" TEXT NOT NULL DEFAULT '';

-- Was ON DELETE RESTRICT, which made a device row with shifts undeletable.
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_deviceId_fkey";
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "shifts_storeId_terminalName_endedAt_idx" ON "shifts"("storeId", "terminalName", "endedAt");
