import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { NavigationContainer, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import { IconButton, SyncStatusBadge, ThemeProvider, ToastProvider } from '@baraka/mobile-ui'
import { useSyncStatus } from '@baraka/mobile-shell'
import { openDatabase } from './platform/database'
import { getServices } from './platform/services'
import { useAuthStore } from './platform/authStore'
import { LoginScreen } from './screens/LoginScreen'
import { OpenSessionScreen } from './screens/OpenSessionScreen'
import { RegisterScreen } from './screens/RegisterScreen'
import { PaymentScreen } from './screens/PaymentScreen'
import { CloseSessionScreen } from './screens/CloseSessionScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SalesHistoryScreen } from './screens/SalesHistoryScreen'
import { PrinterSettingsScreen } from './screens/PrinterSettingsScreen'
import { colors } from './theme'
import type { RootStackParamList } from './navigation'

const Stack = createNativeStackNavigator<RootStackParamList>()

function HeaderSyncBadge() {
  const status = useSyncStatus()
  return <SyncStatusBadge state={status.state} pendingCount={status.pendingCount} />
}

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

export default function AppRoot() {
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState('')
  const { isAuthenticated, session, setSession } = useAuthStore()

  useEffect(() => {
    try {
      openDatabase() // runs shared migrations on first open
      setReady(true)
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Database initialization failed')
    }
  }, [])

  // Restore an open session for this terminal after login.
  useEffect(() => {
    if (!ready || !isAuthenticated) return
    const { repos } = getServices()
    const terminalId = repos.settings.get('terminal_id', 'ANDROID-1')
    setSession(repos.sessions.current(terminalId))
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
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" />
        {!isAuthenticated ? (
          <LoginScreen />
        ) : !session ? (
          <OpenSessionScreen />
        ) : (
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '700' },
            }}
          >
            <Stack.Screen
              name="Register"
              component={RegisterScreen}
              options={({ navigation }) => ({
                title: 'BarakaPOS',
                headerRight: () => (
                  <View style={styles.headerActions}>
                    <HeaderSyncBadge />
                    <IconButton
                      icon="history"
                      accessibilityLabel="Sales history"
                      color={colors.primary}
                      onPress={() => navigation.navigate('SalesHistory')}
                    />
                    <IconButton
                      icon="lock"
                      accessibilityLabel="Close register"
                      color={colors.primary}
                      onPress={() => navigation.navigate('CloseSession')}
                    />
                    <IconButton
                      icon="settings"
                      accessibilityLabel="Settings"
                      color={colors.primary}
                      onPress={() => navigation.navigate('Settings')}
                    />
                  </View>
                ),
              })}
            />
            <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: 'Payment' }} />
            <Stack.Screen name="CloseSession" component={CloseSessionScreen} options={{ title: 'Close Register' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            <Stack.Screen name="SalesHistory" component={SalesHistoryScreen} options={{ title: 'Sales' }} />
            <Stack.Screen name="PrinterSettings" component={PrinterSettingsScreen} options={{ title: 'Printer' }} />
          </Stack.Navigator>
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
  headerActions: { flexDirection: 'row', gap: 4, alignItems: 'center' },
})
