import { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import { colors } from '../theme'

export function SettingsScreen() {
  const { repos, engine } = getServices()
  const logoutStore = useAuthStore((s) => s.logout)

  // Explicit sign-out must forget the cached identity, or the login screen's
  // offline-restore effect signs the user straight back in. Device
  // registration, server URL, and terminal id survive — they belong to the
  // device, not the user.
  function logout() {
    repos.settings.set('cached_user', '')
    repos.settings.set('cached_store', '')
    logoutStore()
  }
  const [serverUrl, setServerUrl] = useState('')
  const [terminalId, setTerminalId] = useState('')
  const [registered, setRegistered] = useState(false)
  const [pending, setPending] = useState(0)
  const [dead, setDead] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState('')

  function refresh() {
    setServerUrl(repos.settings.get('server_url'))
    setTerminalId(repos.settings.get('terminal_id'))
    setRegistered(engine.isDeviceRegistered())
    setPending(queueCount('pending'))
    setDead(queueCount('dead'))
  }

  function queueCount(status: string): number {
    const row = getServicesDb().get<{ c: number }>(
      `SELECT COUNT(*) c FROM sync_queue_local WHERE status=?`, [status]
    )
    return row?.c ?? 0
  }

  useEffect(refresh, [])

  async function syncNow() {
    setSyncing(true)
    try {
      const flush = await engine.flushOutbox()
      let pulled = 0
      for (const table of PULL_TABLE_ORDER) {
        const r = await engine.pullTableV2(table)
        pulled += r.count
      }
      setLastResult(`Pushed ${flush.synced}, pulled ${pulled} records`)
    } catch (err) {
      setLastResult(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
      refresh()
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.section}>Server</Text>
      <TextInput
        style={styles.input}
        value={serverUrl}
        onChangeText={setServerUrl}
        autoCapitalize="none"
        placeholder="Server URL"
        placeholderTextColor={colors.textMuted}
      />
      <TouchableOpacity style={styles.smallBtn} onPress={() => { repos.settings.set('server_url', serverUrl.replace(/\/+$/, '')); Alert.alert('Saved') }}>
        <Text style={styles.smallBtnText}>Save URL</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Device</Text>
      <View style={styles.card}>
        <Text style={styles.kv}>Terminal: <Text style={styles.kvValue}>{terminalId || '—'}</Text></Text>
        <Text style={styles.kv}>
          Registration:{' '}
          <Text style={[styles.kvValue, { color: registered ? colors.success : colors.danger }]}>
            {registered ? 'registered' : 'not registered — sign in online as manager/admin'}
          </Text>
        </Text>
      </View>

      <Text style={styles.section}>Sync</Text>
      <View style={styles.card}>
        <Text style={styles.kv}>Pending: <Text style={styles.kvValue}>{pending}</Text></Text>
        <Text style={styles.kv}>Failed (dead): <Text style={[styles.kvValue, dead > 0 && { color: colors.danger }]}>{dead}</Text></Text>
        {lastResult ? <Text style={[styles.kv, { marginTop: 6 }]}>{lastResult}</Text> : null}
      </View>
      <TouchableOpacity style={styles.button} onPress={syncNow} disabled={syncing}>
        <Text style={styles.buttonText}>{syncing ? 'Syncing…' : 'Sync Now'}</Text>
      </TouchableOpacity>
      {dead > 0 && (
        <TouchableOpacity
          style={[styles.smallBtn, { borderColor: colors.danger }]}
          onPress={() => { engine.retryDeadLetters(); refresh() }}
        >
          <Text style={[styles.smallBtnText, { color: colors.danger }]}>Retry failed items</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.button, { backgroundColor: colors.border, marginTop: 28 }]} onPress={logout}>
        <Text style={styles.buttonText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

// Local helper: reuse the app's singleton adapter for the two queue counters.
import { createDbAdapter } from '../platform/database'
let _db: ReturnType<typeof createDbAdapter> | null = null
function getServicesDb() {
  if (!_db) _db = createDbAdapter()
  return _db
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, maxWidth: 520, width: '100%', alignSelf: 'center' },
  section: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, color: colors.text,
  },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, gap: 4 },
  kv: { color: colors.textMuted, fontSize: 14 },
  kvValue: { color: colors.text, fontWeight: '600' },
  button: {
    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 10, minHeight: 48, justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  smallBtn: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10,
    alignItems: 'center', marginTop: 8,
  },
  smallBtnText: { color: colors.textMuted, fontWeight: '600' },
})
