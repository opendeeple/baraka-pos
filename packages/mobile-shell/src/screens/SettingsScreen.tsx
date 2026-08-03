import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import {
  Button,
  Card,
  Input,
  Row,
  Screen,
  SectionHeader,
  SyncStatusBadge,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { spacing } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { outboxCounts } from '../platform/maintenance'

/** Shared settings screen — identical needs in both apps. */
export function SettingsScreen() {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const logoutStore = useAuthStore((s) => s.logout)

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
    const counts = outboxCounts()
    setPending(counts.pending)
    setDead(counts.dead)
  }

  useEffect(refresh, [])

  // Explicit sign-out must forget the cached identity, or the login screen's
  // offline-restore effect signs the user straight back in. Device
  // registration, server URL, and terminal id survive — they belong to the
  // device, not the user.
  function logout() {
    repos.settings.set('cached_user', '')
    repos.settings.set('cached_store', '')
    logoutStore()
  }

  function saveUrl() {
    repos.settings.set('server_url', serverUrl.replace(/\/+$/, ''))
    toast.success('Server URL saved')
  }

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
      toast.success('Sync complete')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      setLastResult(msg)
      toast.error(msg)
    } finally {
      setSyncing(false)
      refresh()
    }
  }

  return (
    <Screen scroll maxWidth={560}>
      <SectionHeader title="Server" />
      <Input
        value={serverUrl}
        onChangeText={setServerUrl}
        autoCapitalize="none"
        placeholder="Server URL"
        keyboardType="url"
      />
      <Button title="Save URL" variant="secondary" size="sm" onPress={saveUrl} style={styles.gapTop} />

      <SectionHeader title="Device" />
      <Card>
        <Row label="Terminal" value={terminalId || '—'} />
        <Row
          label="Registration"
          value={registered ? 'Registered' : 'Not registered'}
          valueColor={registered ? theme.success : theme.danger}
        />
      </Card>

      <SectionHeader
        title="Sync"
        right={
          <SyncStatusBadge
            state={dead > 0 ? 'error' : pending > 0 ? 'pending' : 'synced'}
            pendingCount={pending + dead}
          />
        }
      />
      <Card>
        <Row label="Pending" value={String(pending)} />
        <Row label="Failed (dead)" value={String(dead)} valueColor={dead > 0 ? theme.danger : undefined} />
        {lastResult ? <Row label="Last sync" value={lastResult} /> : null}
      </Card>
      <Button
        title={syncing ? 'Syncing…' : 'Sync Now'}
        onPress={syncNow}
        loading={syncing}
        fullWidth
        style={styles.gapTop}
      />
      {dead > 0 && (
        <Button
          title="Retry failed items"
          variant="danger"
          size="sm"
          onPress={() => {
            engine.retryDeadLetters()
            refresh()
            toast.info('Retrying failed items')
          }}
          style={styles.gapTop}
        />
      )}

      <View style={styles.logoutWrap}>
        <Button title="Log out" variant="secondary" icon="logout" onPress={logout} fullWidth />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  gapTop: { marginTop: spacing.sm },
  logoutWrap: { marginTop: spacing.x3l },
})
