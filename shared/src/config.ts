/**
 * Canonical production server URL — the single source of truth for every app
 * (desktop POS/Office, Android POS/Office, sync engine). End users never see
 * or type a server address; the field was removed from the login screens.
 *
 * For local development, override at build time:
 *   - desktop (Vite):   VITE_SERVER_URL=http://localhost:3001
 *   - mobile (Expo):    EXPO_PUBLIC_SERVER_URL=http://10.0.2.2:3001
 *   - node/e2e scripts: SERVER_URL=http://localhost:3001
 * Resolution helpers live next to each consumer; this constant is the default.
 */
export const DEFAULT_SERVER_URL = 'https://barakapos-server.onrender.com'

/**
 * Settings that are the same for the whole store and sync between every
 * device (server ↔ tills ↔ office). Everything else in the local `settings`
 * table is per device — printer, paper layout, UI language, sync cursors.
 */
export const SHARED_SETTING_KEYS: readonly string[] = [
  'receipt_template', 'telegram_config', 'sms_config', 'auto_reminder_config',
  'debt_sale_notify_config', 'owner_expense_pin', 'scale_barcode_config',
  'creditor_reminder_config',
]
