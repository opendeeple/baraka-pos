import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { NavigationContainer, DarkTheme } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { StatusBar } from 'expo-status-bar'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import { openDatabase } from './platform/database'
import { getServices } from './platform/services'
import { useAuthStore } from './platform/authStore'
import { LoginScreen } from './screens/LoginScreen'
import { DashboardScreen } from './screens/DashboardScreen'
import { ProductsScreen } from './screens/ProductsScreen'
import { CustomersScreen } from './screens/CustomersScreen'
import { SalesScreen } from './screens/SalesScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { colors } from './theme'

const Tab = createBottomTabNavigator()

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

const TAB_ICONS: Record<string, string> = {
  Dashboard: '▦',
  Products: '⬚',
  Customers: '☺',
  Sales: '≡',
  Settings: '⚙',
}

export default function AppRoot() {
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState('')
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    try {
      openDatabase()
      setReady(true)
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Database initialization failed')
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

  if (bootError) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.danger, textAlign: 'center' }}>{bootError}</Text>
      </View>
    )
  }
  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    )
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      {!isAuthenticated ? (
        <LoginScreen />
      ) : (
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700' },
            tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: 18 }}>{TAB_ICONS[route.name] ?? '•'}</Text>
            ),
          })}
        >
          <Tab.Screen name="Dashboard" component={DashboardScreen} />
          <Tab.Screen name="Products" component={ProductsScreen} />
          <Tab.Screen name="Customers" component={CustomersScreen} />
          <Tab.Screen name="Sales" component={SalesScreen} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
        </Tab.Navigator>
      )}
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
})
