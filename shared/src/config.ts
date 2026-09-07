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
