// @baraka/mobile-shell — shared platform layer + shared screens for the two
// Android apps (the pre-refactor byte-identical duplicates, consolidated).
export { openDatabase, createDbAdapter } from './platform/database'
export { useAuthStore, type StoreInfo } from './platform/authStore'
export { getServices, type Services } from './platform/services'
export { outboxCounts, type OutboxCounts } from './platform/maintenance'
export { useSyncStatus, type SyncStatus } from './hooks/useSyncStatus'
export { LoginScreen, type LoginScreenProps } from './screens/LoginScreen'
export { SettingsScreen } from './screens/SettingsScreen'
