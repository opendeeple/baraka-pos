import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import {
  Button,
  Card,
  Chip,
  Dialog,
  Input,
  Row,
  Screen,
  SectionHeader,
  SyncStatusBadge,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { LANGUAGES, setAppLanguage, useTranslation, type AppLanguage } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { outboxCounts } from '../platform/maintenance'

/** Shared settings screen — identical needs in both apps; `extras` lets an
 * app append its own sections (e.g. the POS printer setup link). */
export function SettingsScreen({ extras }: { extras?: React.ReactNode }) {
  const theme = useTheme()
  const { t, i18n } = useTranslation()
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
        setReauthError(typeof data?.error === 'string' ? data.error : t('settings.signInFailed'))
        return
      }
      // Only refreshes the device's sync credential — the cashier's own
      // session (useAuthStore) is untouched, so this doesn't log anyone out.
      await engine.setTerminalToken(data.token, data.user.role)
      setReauthOpen(false)
      setReauthPassword('')
      toast.success(t('settings.syncSignedInAgain'))
      refresh()
    } catch (err) {
      setReauthError(err instanceof Error ? err.message : t('settings.signInFailed'))
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
    toast.success(t('settings.serverUrlSaved'))
  }

  function changeLanguage(lang: AppLanguage) {
    setAppLanguage(repos.settings, lang)
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
      setLastResult(t('settings.syncResult', { pushed: flush.synced, pulled }))
      toast.success(t('settings.syncComplete'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.syncFailed')
      setLastResult(msg)
      toast.error(msg)
    } finally {
      setSyncing(false)
      refresh()
    }
  }

  return (
    <Screen scroll maxWidth={560}>
      <SectionHeader title={t('settings.language')} />
      <View style={styles.chipRow}>
        {LANGUAGES.map((l) => (
          <Chip key={l.code} label={l.label} selected={i18n.language === l.code} onPress={() => changeLanguage(l.code)} />
        ))}
      </View>

      <SectionHeader title={t('settings.server')} />
      <Input
        value={serverUrl}
        onChangeText={setServerUrl}
        autoCapitalize="none"
        placeholder={t('settings.serverUrlPlaceholder')}
        keyboardType="url"
      />
      <Button title={t('settings.saveUrl')} variant="secondary" size="sm" onPress={saveUrl} style={styles.gapTop} />

      <SectionHeader title={t('settings.device')} />
      <Card>
        <Row label={t('settings.terminal')} value={terminalId || '—'} />
      </Card>

      <SectionHeader
        title={t('settings.sync')}
        right={
          <SyncStatusBadge
            state={!tokenOk ? 'error' : dead > 0 ? 'error' : pending > 0 ? 'pending' : 'synced'}
            pendingCount={pending + dead}
          />
        }
      />
      {!tokenOk && (
        <Card style={[styles.gapTop, { borderColor: theme.danger, borderWidth: 1 }]}>
          <Text style={[typeScale.sm, { color: theme.text }]}>{t('settings.syncPaused')}</Text>
          <Button
            title={t('settings.signInAgain')}
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
        <Row label={t('settings.pending')} value={String(pending)} />
        <Row label={t('settings.failedDead')} value={String(dead)} valueColor={dead > 0 ? theme.danger : undefined} />
        {lastResult ? <Row label={t('settings.lastSync')} value={lastResult} /> : null}
      </Card>
      <Button
        title={syncing ? t('settings.syncing') : t('settings.syncNow')}
        onPress={syncNow}
        loading={syncing}
        fullWidth
        style={styles.gapTop}
      />
      {dead > 0 && (
        <Button
          title={t('settings.retryFailed')}
          variant="danger"
          size="sm"
          onPress={() => {
            engine.retryDeadLetters()
            refresh()
            toast.info(t('settings.retryingFailed'))
          }}
          style={styles.gapTop}
        />
      )}

      {extras}

      <View style={styles.logoutWrap}>
        <Button title={t('settings.logOut')} variant="secondary" icon="logout" onPress={logout} fullWidth />
      </View>

      <Dialog
        visible={reauthOpen}
        onClose={() => setReauthOpen(false)}
        title={t('settings.signInToSync')}
        message={t('settings.signInToSyncHint')}
        actions={[
          { label: t('common.cancel'), onPress: () => setReauthOpen(false) },
          { label: t('auth.signIn'), tone: 'primary', onPress: reauth },
        ]}
      >
        <Input
          value={reauthUsername}
          onChangeText={setReauthUsername}
          label={t('auth.username')}
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={styles.gapTop}
        />
        <Input
          value={reauthPassword}
          onChangeText={setReauthPassword}
          label={t('auth.password')}
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  logoutWrap: { marginTop: spacing.x3l },
})
