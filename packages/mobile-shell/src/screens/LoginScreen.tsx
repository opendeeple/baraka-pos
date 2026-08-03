import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { AuthUser } from '@baraka/shared'
import { Button, Input, Screen, useTheme } from '@baraka/mobile-ui'
import { type as typeScale, spacing } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore, type StoreInfo } from '../platform/authStore'

const DEFAULT_SERVER = 'https://barakapos-server.onrender.com'

export interface LoginScreenProps {
  subtitle: string
  platformKind: 'android-pos' | 'android-office'
}

/** Shared login: the two apps differ only by subtitle and device platform. */
export function LoginScreen({ subtitle, platformKind }: LoginScreenProps) {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER)
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
      const savedUrl = repos.settings.get('server_url')
      if (savedUrl) setServerUrl(savedUrl)
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
      const base = serverUrl.replace(/\/+$/, '')
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (res.status !== 200) throw new Error(data?.error ?? 'Login failed')

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
              value={serverUrl}
              onChangeText={setServerUrl}
              label="Server URL"
              placeholder="https://…"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
            />
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
