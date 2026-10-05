-- Second reset before go-live, at the owner's request: test sales from
-- before quantities were stored exactly (box pieces rounded to 0.01 box) and
-- products tied to deleted categories made the numbers unreliable, so the
-- store starts from zero again. Same scope as 20261005100000_reset_all_data:
-- kept are the store record, admin logins, settings and charges; sale
-- numbers restart from 1.
--
-- Every terminal must drop its local database (%APPDATA%\baraka-pos\
-- baraka.db*) AFTER this has deployed and before it signs in again: a TRUNCATE
-- leaves no tombstones, so an old local copy would keep its stale rows and
-- push them back.
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
