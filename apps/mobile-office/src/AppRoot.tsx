import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import { Icon, IconButton, SyncStatusBadge, ThemeProvider, ToastProvider, type IconName } from '@baraka/mobile-ui'
import { useSyncStatus } from '@baraka/mobile-shell'
import { initI18n, loadPersistedLanguage, useTranslation } from '@baraka/mobile-i18n'
import { openDatabase } from './platform/database'
import { getServices } from './platform/services'
import { useAuthStore } from './platform/authStore'

// Starts synchronously on the default language so nothing blocks on a DB
// read — loadPersistedLanguage() below reconciles with the saved choice
// once the database is open. Mirrors desktop's client/src/i18n/index.ts.
initI18n()
import { LoginScreen } from './screens/LoginScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { ProductsScreen } from './screens/ProductsScreen'
import { CustomersScreen } from './screens/CustomersScreen'
import { SalesScreen } from './screens/SalesScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { ExpensesScreen } from './screens/ExpensesScreen'
import { WarehouseScreen } from './screens/WarehouseScreen'
import { PurchasesScreen } from './screens/PurchasesScreen'
import { CategoriesScreen } from './screens/CategoriesScreen'
import { SuppliersScreen } from './screens/SuppliersScreen'
import { CreditorsScreen } from './screens/CreditorsScreen'
import { EmployeesScreen } from './screens/EmployeesScreen'
import { JournalScreen } from './screens/JournalScreen'
import { ReportsScreen } from './screens/ReportsScreen'
import { SideMenu } from './components/SideMenu'
import type { RootStackParamList } from './navigation'
import { colors } from './theme'

const Tab = createBottomTabNavigator()
const RootStack = createNativeStackNavigator<RootStackParamList>()
// Imperative nav ref: lets SideMenu (rendered outside any navigator, so it
// stays on top of everything) push a screen without needing to be inside
// the stack it's navigating.
const navigationRef = createNavigationContainerRef<RootStackParamList>()

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    primary: colors.primary,
    text: colors.text,
  },
}

function HeaderSyncBadge() {
  const status = useSyncStatus()
  return (
    <View style={{ marginRight: 16 }}>
      <SyncStatusBadge state={status.state} pendingCount={status.pendingCount} />
    </View>
  )
}

const TAB_ICONS: Record<string, IconName> = {
  Dashboard: 'dashboard',
  Products: 'package',
  Customers: 'users',
  Sales: 'sales',
  Settings: 'settings',
}

const TAB_TITLES: Record<string, string> = {
  Dashboard: 'nav.dashboard',
  Products: 'nav.products',
  Customers: 'nav.customers',
  Sales: 'nav.sales',
  Settings: 'nav.settings',
}

// The 5 primary destinations. Every other screen (Expenses, Warehouse, ...)
// is a RootStack sibling reached via the hamburger button's SideMenu, not a
// tab — see navigation.ts.
function MainTabs({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useTranslation()
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        title: TAB_TITLES[route.name] ? t(TAB_TITLES[route.name]) : route.name,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerLeft: () => (
          <IconButton
            icon="menu"
            accessibilityLabel={t('nav.moreMenu')}
            onPress={onOpenMenu}
            style={styles.menuButton}
          />
        ),
        headerRight: () => <HeaderSyncBadge />,
        tabBarLabel: TAB_TITLES[route.name] ? t(TAB_TITLES[route.name]) : route.name,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color }) => (
          <Icon name={TAB_ICONS[route.name] ?? 'none'} size={20} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Products" component={ProductsScreen} />
      <Tab.Screen name="Customers" component={CustomersScreen} />
      <Tab.Screen name="Sales" component={SalesScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  )
}

export default function AppRoot() {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState('')
  const [sideMenuOpen, setSideMenuOpen] = useState(false)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    try {
      openDatabase()
      loadPersistedLanguage(getServices().repos.settings)
      setReady(true)
    } catch (err) {
      setBootError(err instanceof Error ? err.message : t('common.dbInitFailed'))
    }
  }, [])

  // Background sync on sign-in (and app relaunch): pull everything, flush the
  // outbox, and keep flushing periodically — screens then read fresh local data.
  useEffect(() => {
    if (!ready || !isAuthenticated) return
    const { engine } = getServices()
    Promise.resolve().then(async () => {
      try {
        for (const table of PULL_TABLE_ORDER) await engine.pullTableV2(table)
        await engine.flushOutbox()
      } catch { /* offline — local data is authoritative */ }
    })
    const flushInterval = setInterval(() => {
      getServices().engine.flushOutbox().catch(() => {})
    }, 60_000)
    return () => clearInterval(flushInterval)
  }, [ready, isAuthenticated])

  let body
  if (bootError) {
    body = (
      <View style={styles.center}>
        <Text style={{ color: colors.danger, textAlign: 'center' }}>{bootError}</Text>
      </View>
    )
  } else if (!ready) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    )
  } else {
    body = (
      <NavigationContainer theme={navTheme} ref={navigationRef}>
        <StatusBar style="light" />
        {!isAuthenticated ? (
          <LoginScreen />
        ) : (
          <>
            <RootStack.Navigator
              screenOptions={{
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: '700' },
                headerRight: () => <HeaderSyncBadge />,
              }}
            >
              <RootStack.Screen name="Tabs" options={{ headerShown: false }}>
                {() => <MainTabs onOpenMenu={() => setSideMenuOpen(true)} />}
              </RootStack.Screen>
              <RootStack.Screen name="Expenses" component={ExpensesScreen} options={{ title: t('nav.expenses') }} />
              <RootStack.Screen name="Warehouse" component={WarehouseScreen} options={{ title: t('nav.warehouse') }} />
              <RootStack.Screen name="Purchases" component={PurchasesScreen} options={{ title: t('nav.purchases') }} />
              <RootStack.Screen name="Categories" component={CategoriesScreen} options={{ title: t('nav.categories') }} />
              <RootStack.Screen name="Suppliers" component={SuppliersScreen} options={{ title: t('nav.suppliers') }} />
              <RootStack.Screen name="Creditors" component={CreditorsScreen} options={{ title: t('nav.creditors') }} />
              <RootStack.Screen name="Employees" component={EmployeesScreen} options={{ title: t('nav.employees') }} />
              <RootStack.Screen name="Journal" component={JournalScreen} options={{ title: t('nav.journal') }} />
              <RootStack.Screen name="Reports" component={ReportsScreen} options={{ title: t('nav.reports') }} />
            </RootStack.Navigator>
            <SideMenu
              visible={sideMenuOpen}
              onClose={() => setSideMenuOpen(false)}
              onNavigate={(screen) => {
                setSideMenuOpen(false)
                navigationRef.current?.navigate(screen)
              }}
            />
          </>
        )}
      </NavigationContainer>
    )
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>{body}</ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  menuButton: { marginLeft: 8 },
})
