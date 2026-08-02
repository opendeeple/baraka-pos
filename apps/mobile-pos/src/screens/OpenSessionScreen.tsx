import { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import { NumPad, applyNumKey } from '../components/NumPad'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { colors } from '../theme'

export function OpenSessionScreen() {
  const { repos } = getServices()
  const { user, store, setSession } = useAuthStore()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')

  function openSession() {
    try {
      const terminalId = repos.settings.get('terminal_id', 'ANDROID-1')
      const session = repos.sessions.open({
        storeId: store?.id ?? 1,
        terminalId,
        userId: user?.id ?? 1,
        openingBalance: Number(amount) || 0,
      })
      setSession(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open session')
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Open Register</Text>
      <Text style={styles.subtitle}>Enter the opening cash balance</Text>
      <Text style={styles.amount}>{amount ? fmtUZS(Number(amount)) : '0.00'}</Text>
      <View style={styles.pad}>
        <NumPad onKey={(k) => setAmount((v) => applyNumKey(v, k))} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={openSession}>
        <Text style={styles.buttonText}>Open Session</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.text, fontSize: 24, fontWeight: 'bold' },
  subtitle: { color: colors.textMuted, fontSize: 14, marginTop: 4, marginBottom: 20 },
  amount: { color: colors.primary, fontSize: 36, fontWeight: 'bold', marginBottom: 20 },
  pad: { width: '100%', maxWidth: 360 },
  error: { color: colors.danger, marginTop: 12 },
  button: {
    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, paddingHorizontal: 48,
    marginTop: 24, minHeight: 50, justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
