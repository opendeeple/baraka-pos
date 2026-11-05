// The app's top-level stack: the bottom-tab group plus every screen the
// left slide-out menu (SideMenu) opens as a drill-in. Keeping these as
// stack screens (not nested under a tab) is what lets the side menu
// navigate to any of them from anywhere in the tab group.
export type RootStackParamList = {
  Tabs: undefined
  Expenses: undefined
  Warehouse: undefined
  Purchases: undefined
  Categories: undefined
  Suppliers: undefined
  Creditors: undefined
  Employees: undefined
  Journal: undefined
  Reports: undefined
}
