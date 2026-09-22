-- Customer messaging (Telegram now, SMS later): a chat id captured once the
-- customer starts the bot, and a server-only log of what was sent (this
-- table is deliberately not part of the local-first sync engine — sending a
-- message always needs connectivity, so the desktop app calls the REST
-- endpoints directly rather than going through the offline sync outbox).

ALTER TABLE "contacts" ADD COLUMN "telegramChatId" TEXT;

CREATE TYPE "MessageChannel" AS ENUM ('telegram', 'sms');
CREATE TYPE "MessageStatus" AS ENUM ('sent', 'failed');

CREATE TABLE "message_logs" (
    "id" SERIAL PRIMARY KEY,
    "storeId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    CONSTRAINT "message_logs_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
);

CREATE INDEX "message_logs_contactId_sentAt_idx" ON "message_logs"("contactId", "sentAt");
