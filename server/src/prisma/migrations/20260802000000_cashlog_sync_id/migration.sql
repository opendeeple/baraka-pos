-- Cash movements become a pushable sync fact: they need a syncId.
ALTER TABLE "cash_logs" ADD COLUMN "syncId" TEXT;
UPDATE "cash_logs" SET "syncId" = gen_random_uuid() WHERE "syncId" IS NULL;
ALTER TABLE "cash_logs" ALTER COLUMN "syncId" SET NOT NULL;
CREATE UNIQUE INDEX "cash_logs_syncId_key" ON "cash_logs"("syncId");
