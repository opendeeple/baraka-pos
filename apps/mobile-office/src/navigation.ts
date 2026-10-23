// The "More" tab's own stack — keeps the bottom tab bar at 6 top-level
// destinations while this and future mobile-parity features (warehouse,
// purchases) get their own drill-in screen instead of each needing a new tab.
export type MoreStackParamList = {
  MoreMenu: undefined
  Expenses: undefined
  Warehouse: undefined
}
