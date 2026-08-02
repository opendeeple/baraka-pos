# BarakaPOS Android Apps

Two offline-first React Native (Expo SDK 57) apps living in the pnpm workspace:

| App | Path | Package id | Purpose |
|---|---|---|---|
| BarakaPOS | `apps/mobile-pos` | `com.baraka.pos.android` | Register: sessions, cart, payments, barcode scanning, receipt printing |
| Baraka Office | `apps/mobile-office` | `com.baraka.office.android` | Back office: dashboard, products, customers, sales, settings |

Both share the same foundation as the Electron desktop apps:

- **`@baraka/db-schema`** — the 22-table SQLite schema + versioned migrations (`PRAGMA user_version`), run on `expo-sqlite` at startup.
- **`@baraka/sync-engine`** — sync protocol v2 client (device registration, store-scoped incremental pull with tombstones, outbox push with retry/backoff/dead-letter, invoice-range leasing). See `docs/sync-v2.md`.
- **`@baraka/data`** — repositories (products, contacts, sales, sessions, settings, held carts, local reports). `SaleRepository.createSale` is the same atomic sale transaction the desktop POS performs.
- **`@baraka/app-core`** — cart store (zustand), currency formatting, receipt model/renderer.

Metro resolves these from TS source via the `"react-native": "src/index.ts"` field in each package manifest (see `apps/*/metro.config.js` — do not add a global `source`-first `resolverMainFields`, it breaks Expo's own packages; keep hierarchical lookup ON for pnpm).

## Running in development

```bash
# start the backend (Postgres + seed data required)
pnpm server:dev

# start Metro for an app
pnpm mobile:pos          # or mobile:office
# then press `a` for the Android emulator, or scan the QR with a dev build
```

Native modules (expo-sqlite, expo-secure-store, expo-camera, react-native-tcp-socket)
mean **Expo Go will not work** — build a dev client once:

```bash
pnpm mobile:pos:android           # local build onto a connected device/emulator
# or with EAS:
pnpm mobile:build:pos -- --profile development
```

On a physical device, set the server URL on the login screen to your dev
machine's LAN IP (e.g. `http://192.168.1.20:3001`) — not `localhost`.

## First-run flow

1. Sign in online as a **manager/admin** once — this registers the device
   (per-device key, stored in the local settings DB) and leases an invoice
   number range for offline receipts.
2. The first sync pulls all reference tables (products, prices, stocks,
   contacts, users, settings).
3. After that, the app is fully offline-capable: login restore is local,
   sales queue in the outbox, and sync resumes automatically when online
   (Settings → Sync Now forces a cycle; dead-lettered items can be retried
   from there).

## Builds (EAS)

`apps/*/eas.json` profiles: `development` (dev client APK), `preview`
(internal QA APK, auto-incrementing versionCode), `production` (APK —
POS fleets sideload/MDM-install; add an AAB profile only if Play Store
distribution happens).

## Printing (POS app)

`src/printing/` behind a `PrinterDriver` interface:

- **network** — implemented: raw ESC/POS to `<ip>:9100` via
  `react-native-tcp-socket`, includes cash-drawer kick for cash sales.
  Configure via the `printer_config` settings JSON:
  `{"type":"network","address":"192.168.1.50","port":9100,"width":32}`.
- **bluetooth** / **sunmi** — stubbed; require physical hardware to implement
  (`react-native-bluetooth-classic` SPP and a small Sunmi InnerPrinter Expo
  module respectively). The call sites don't change.

## Known limitations / next steps

- Bluetooth + Sunmi printer drivers and the Sunmi broadcast-scanner module
  need real hardware (see `docs/hardware-test-checklist.md` intent in the plan).
- Office app ships the core five screens; purchases/expenses/employees screens
  are still desktop-only.
- Held carts: the register cart panel shows a "held — tap to restore latest"
  pill; a full held-cart list/picker is a future refinement.
- Offline PIN login (verify against pulled `users.pin_code`) is not yet wired —
  offline restore currently uses the cached last user, same as desktop.
- socket.io realtime (`sale:completed`, `sync:changed`) is not yet connected in
  the mobile apps; sync runs on screen-focus/interval/manual triggers.
