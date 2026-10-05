-- One-time reset before go-live: wipes everything entered during testing so
-- the store starts from zero. Kept: the store record, admin logins, settings
-- and charges. Sale numbers restart from 1.
--
-- Device registrations are wiped too, on purpose: a terminal that still holds
-- its old local database can no longer authenticate, so it cannot push stale
-- rows into the clean server. Each terminal must drop its local database
-- (%APPDATA%\baraka-pos\baraka.db*) and log in as admin to register again.
--
-- Identity sequences are NOT restarted, so new rows never reuse an id that a
-- not-yet-wiped terminal still maps to an old row.
--
-- No CASCADE: if a table referencing one of these is ever left out, the
-- TRUNCATE fails instead of silently emptying it.

TRUNCATE TABLE
    "sale_items",
    "payment_transactions",
    "loyalty_point_transactions",
    "sales",
    "cash_logs",
    "expenses",
    "pos_sessions",
    "shifts",
    "devices",
    "quantity_adjustments",
    "product_stocks",
    "purchase_items",
    "purchases",
    "product_batches",
    "collection_product",
    "products",
    "collections",
    "debt_clearances",
    "message_logs",
    "audit_logs",
    "salary_records",
    "employees",
    "contacts";

-- Only admin logins stay — and only if one exists, so the store can never be
-- left without anyone able to sign in.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "users"
        WHERE "role" IN ('admin', 'super_admin') AND "isActive" AND "deletedAt" IS NULL
    ) THEN
        DELETE FROM "users" WHERE "role" NOT IN ('admin', 'super_admin');
    END IF;
END $$;

UPDATE "stores" SET "currentSaleNumber" = 0;
