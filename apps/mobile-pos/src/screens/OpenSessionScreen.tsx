import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import { Button, NumPad, Screen, applyNumKey, useTheme, Text } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

export function OpenSessionScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
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
      setError(err instanceof Error ? err.message : t('session.failedToOpen'))
    }
  }

  return (
    <Screen scroll edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.center}>
        <Text style={[typeScale.title, { color: theme.text, textAlign: 'center' }]}>{t('session.openRegister')}</Text>
        <Text style={[typeScale.sm, styles.subtitle, { color: theme.textMuted, textAlign: 'center' }]}>
          {t('session.enterOpeningBalance')}
        </Text>
        <Text
          style={[typeScale.moneyDisplay, styles.amount, { color: theme.primary }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          accessibilityLabel={`${t('session.openingBalance')} ${amount || '0'}`}
        >
          {amount ? fmtUZS(Number(amount)) : fmtUZS(0)}
        </Text>
        <View style={styles.pad}>
          <NumPad onKey={(k) => setAmount((v) => applyNumKey(v, k))} />
        </View>
        {error ? <Text style={[typeScale.sm, styles.error, { color: theme.danger }]}>{error}</Text> : null}
        <Button title={t('session.openSession')} size="lg" onPress={openSession} style={styles.submit} testID="open-session" />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subtitle: { marginTop: spacing.xs, marginBottom: spacing.xl },
  amount: { marginBottom: spacing.xl },
  pad: { width: '100%', maxWidth: 360 },
  error: { marginTop: spacing.md },
  submit: { marginTop: spacing.xxl, alignSelf: 'stretch', maxWidth: 360, width: '100%' },
})
