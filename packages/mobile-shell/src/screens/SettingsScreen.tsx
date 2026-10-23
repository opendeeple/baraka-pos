import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import {
  Button,
  Card,
  Dialog,
  Input,
  Row,
  Screen,
  SectionHeader,
  SyncStatusBadge,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { outboxCounts } from '../platform/maintenance'

/** Shared settings screen — identical needs in both apps; `extras` lets an
 * app append its own sections (e.g. the POS printer setup link). */
export function SettingsScreen({ extras }: { extras?: React.ReactNode }) {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const logoutStore = useAuthStore((s) => s.logout)
  const authUser = useAuthStore((s) => s.user)

  const [serverUrl, setServerUrl] = useState('')
  const [terminalId, setTerminalId] = useState('')
  const [pending, setPending] = useState(0)
  const [dead, setDead] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState('')
  // The terminal token (what this DEVICE syncs with, separate from the
  // cached user session) expires after 7 days server-side. Unlike desktop,
  // which surfaces this on its always-visible sync badge, a dead token here
  // used to fail every push/pull silently in the background — the cashier
  // kept selling with a growing, never-flushing outbox and no indication
  // anything was wrong until someone noticed stale stock/debt numbers.
  const [tokenOk, setTokenOk] = useState(true)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [reauthUsername, setReauthUsername] = useState('')
  const [reauthPassword, setReauthPassword] = useState('')
  const [reauthError, setReauthError] = useState('')
  const [reauthBusy, setReauthBusy] = useState(false)

  function refresh() {
    setServerUrl(repos.settings.get('server_url'))
    setTerminalId(repos.settings.get('terminal_id'))
    const counts = outboxCounts()
    setPending(counts.pending)
    setDead(counts.dead)
    setTokenOk(engine.hasTerminalToken())
  }

  useEffect(refresh, [])

  async function reauth() {
    if (!reauthUsername.trim() || !reauthPassword || reauthBusy) return
    setReauthBusy(true)
    setReauthError('')
    try {
      const base = (serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '')
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: reauthUsername.trim(), password: reauthPassword }),
      })
      const data = await res.json()
      if (res.status !== 200) {
        setReauthError(typeof data?.error === 'string' ? data.error : 'Sign-in failed')
        return
      }
      // Only refreshes the device's sync credential — the cashier's own
      // session (useAuthStore) is untouched, so this doesn't log anyone out.
      await engine.setTerminalToken(data.token, data.user.role)
      setReauthOpen(false)
      setReauthPassword('')
      toast.success('Sync signed in again')
      refresh()
    } catch (err) {
      setReauthError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setReauthBusy(false)
    }
  }

  // Explicit sign-out must forget the cached identity, or the login screen's
  // offline-restore effect signs the user straight back in. The terminal
  // token, server URL, and terminal id survive — they belong to the device,
  // not the user.
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
      </Card>

      <SectionHeader
        title="Sync"
        right={
          <SyncStatusBadge
            state={!tokenOk ? 'error' : dead > 0 ? 'error' : pending > 0 ? 'pending' : 'synced'}
            pendingCount={pending + dead}
          />
        }
      />
      {!tokenOk && (
        <Card style={[styles.gapTop, { borderColor: theme.danger, borderWidth: 1 }]}>
          <Text style={[typeScale.sm, { color: theme.text }]}>
            Sync paused: sign in again with username and password (7 days since the last sign-in, or never signed in).
          </Text>
          <Button
            title="Sign in again"
            variant="danger"
            size="sm"
            style={styles.gapTop}
            onPress={() => {
              setReauthUsername(authUser?.username ?? '')
              setReauthPassword('')
              setReauthError('')
              setReauthOpen(true)
            }}
          />
        </Card>
      )}
      <Card style={styles.gapTop}>
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

      {extras}

      <View style={styles.logoutWrap}>
        <Button title="Log out" variant="secondary" icon="logout" onPress={logout} fullWidth />
      </View>

      <Dialog
        visible={reauthOpen}
        onClose={() => setReauthOpen(false)}
        title="Sign in to sync"
        message="Only refreshes this device's sync connection — you stay signed in."
        actions={[
          { label: 'Cancel', onPress: () => setReauthOpen(false) },
          { label: 'Sign in', tone: 'primary', onPress: reauth },
        ]}
      >
        <Input
          value={reauthUsername}
          onChangeText={setReauthUsername}
          label="Username"
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={styles.gapTop}
        />
        <Input
          value={reauthPassword}
          onChangeText={setReauthPassword}
          label="Password"
          secureTextEntry
          onSubmitEditing={reauth}
          error={reauthError || null}
          containerStyle={styles.gapTop}
        />
      </Dialog>
    </Screen>
  )
}

const styles = StyleSheet.create({
  gapTop: { marginTop: spacing.sm },
  logoutWrap: { marginTop: spacing.x3l },
})
