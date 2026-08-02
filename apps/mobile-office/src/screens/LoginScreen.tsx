import { useEffect, useState } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import type { AuthUser } from '@baraka/shared'
import { getServices } from '../platform/services'
import { useAuthStore, type StoreInfo } from '../platform/authStore'
import { colors } from '../theme'

const DEFAULT_SERVER = 'https://barakapos-server.onrender.com'

export function LoginScreen() {
  const { repos, engine } = getServices()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(true)

  // Offline restore: cached user + registered device → straight in (same
  // contract as the Electron POS login).
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
      const reg = await engine.ensureDeviceRegistered(data.token, 'android-office')
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

  if (restoring) {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>BarakaPOS</Text>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>BarakaPOS</Text>
      <Text style={styles.subtitle}>Back Office</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="Server URL"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="Username"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { color: colors.primary, fontSize: 40, fontWeight: 'bold' },
  subtitle: { color: colors.textMuted, fontSize: 14, marginBottom: 32 },
  form: { width: '100%', maxWidth: 380, gap: 12 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: colors.text, fontSize: 15,
  },
  error: { color: colors.danger, fontSize: 13 },
  button: {
    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15,
    alignItems: 'center', marginTop: 8, minHeight: 50, justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
