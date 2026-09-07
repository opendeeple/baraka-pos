import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { AuthUser } from '@baraka/shared'
import { Button, Input, Screen, useTheme } from '@baraka/mobile-ui'
import { type as typeScale, spacing } from '@baraka/ui-tokens'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import { getServices } from '../platform/services'
import { useAuthStore, type StoreInfo } from '../platform/authStore'

// Fixed server — end users never see or type an address. Dev override:
// EXPO_PUBLIC_SERVER_URL (e.g. http://10.0.2.2:3001 for a local emulator).
const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || DEFAULT_SERVER_URL

export interface LoginScreenProps {
  subtitle: string
  platformKind: 'android-pos' | 'android-office'
}

/** Shared login: the two apps differ only by subtitle and device platform. */
export function LoginScreen({ subtitle, platformKind }: LoginScreenProps) {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)

  // Offline restore: cached user + registered device → straight in (same
  // contract as the Electron apps).
  useEffect(() => {
    try {
      const cachedUser = repos.settings.getJson<AuthUser>('cached_user')
      const cachedStore = repos.settings.getJson<StoreInfo>('cached_store')
      // Always pin the server to the fixed URL — overwrites any stale address
      // saved by an older build so the sync engine targets production.
      repos.settings.set('server_url', SERVER_URL)
      if (cachedUser && cachedStore) {
        setAuth(cachedUser, null, cachedStore)
        return
      }
    } finally {
      setRestoring(false)
    }
  }, [])

  async function handleLogin() {
    setError('')
    setLoading(true)
    try {
      const base = SERVER_URL.replace(/\/+$/, '')
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (res.status !== 200) {
        // Guard against structured error payloads (e.g. validation issue
        // arrays) leaking into the form — only plain messages are shown.
        const msg = typeof data?.error === 'string' && !data.error.trimStart().startsWith('[') && !data.error.trimStart().startsWith('{')
          ? data.error
          : 'Login failed — check your username and password'
        throw new Error(msg)
      }

      repos.settings.set('server_url', base)
      repos.settings.set('store_id', String(data.store.id))
      repos.settings.setJson('cached_user', data.user)
      repos.settings.setJson('cached_store', data.store)
      if (!repos.settings.get('terminal_id')) {
        repos.settings.set('terminal_id', `ANDROID-${Math.random().toString(36).slice(2, 8).toUpperCase()}`)
      }

      // Device registration needs a manager/admin token the first time.
      const reg = await engine.ensureDeviceRegistered(data.token, platformKind)
      if (!reg.registered && reg.error) {
        console.warn('Device registration pending:', reg.error)
      }

      setAuth(data.user, data.token, data.store)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen keyboard="avoid" edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.center}>
        <Text style={[styles.logo, { color: theme.primary }]}>BarakaPOS</Text>
        <Text style={[typeScale.sm, styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text>

        {restoring ? (
          <ActivityIndicator color={theme.primary} />
        ) : (
          <View style={styles.form}>
            <Input
              value={username}
              onChangeText={setUsername}
              label="Username"
              placeholder="Username"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Input
              value={password}
              onChangeText={setPassword}
              label="Password"
              placeholder="Password"
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              error={error || null}
            />
            <Button
              title="Sign In"
              onPress={handleLogin}
              loading={loading}
              size="lg"
              fullWidth
              style={styles.submit}
              testID="login-submit"
            />
          </View>
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { fontSize: 40, fontWeight: 'bold' },
  subtitle: { marginBottom: spacing.x3l },
  form: { width: '100%', maxWidth: 380, gap: spacing.md },
  submit: { marginTop: spacing.sm },
})
