import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { NavigationContainer, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
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
import { colors } from './theme'
import type { RootStackParamList } from './navigation'

const Stack = createNativeStackNavigator<RootStackParamList>()

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
      ) : !session ? (
        <OpenSessionScreen />
      ) : (
        <Stack.Navigator
          screenOptions={({ navigation }) => ({
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700' },
          })}
        >
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={({ navigation }) => ({
              title: 'BarakaPOS',
              headerRight: () => (
                <View style={{ flexDirection: 'row', gap: 18 }}>
                  <TouchableOpacity onPress={() => navigation.navigate('SalesHistory')}>
                    <Text style={styles.headerAction}>≡</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => navigation.navigate('CloseSession')}>
                    <Text style={styles.headerAction}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
                    <Text style={styles.headerAction}>⚙︎</Text>
                  </TouchableOpacity>
                </View>
              ),
            })}
          />
          <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: 'Payment' }} />
          <Stack.Screen name="CloseSession" component={CloseSessionScreen} options={{ title: 'Close Register' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
          <Stack.Screen name="SalesHistory" component={SalesHistoryScreen} options={{ title: 'Sales' }} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  headerAction: { color: colors.primary, fontSize: 16, fontWeight: '700' },
})
