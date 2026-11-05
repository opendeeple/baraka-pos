import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { fmtUZS } from '@baraka/app-core'
import {
  Button,
  Card,
  Dialog,
  NumPad,
  Row,
  Screen,
  applyNumKey,
  useTheme,
} from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { CashMovementModal } from '../components/CashMovementModal'
import type { RootStackParamList } from '../navigation'

type Props = NativeStackScreenProps<RootStackParamList, 'CloseSession'>

const PAY_I18N: Record<string, string> = {
  Cash: 'payment.methodCash',
  Card: 'payment.methodCard',
  Click: 'payment.methodClick',
  Debt: 'payment.methodDebt',
}

export function CloseSessionScreen({ navigation }: Props) {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos, engine } = getServices()
  const { session, setSession } = useAuthStore()
  const [actual, setActual] = useState('')
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out' | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closedInfo, setClosedInfo] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const summary = useMemo(
    () => (session ? repos.sessions.summary(session.id) : []),
    [session?.id, refreshTick]
  )
  const movements = useMemo(
    () => (session ? repos.sessions.cashMovements(session.id) : []),
    [session?.id, refreshTick]
  )
  const theoretical = useMemo(
    () => (session ? repos.sessions.expectedCash(session.id) : 0),
    [session?.id, refreshTick]
  )
  const variance = (Number(actual) || 0) - theoretical
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), [])

  function close() {
    if (!session) return
    setConfirmClose(false)
    const closed = repos.sessions.close(session.id, Number(actual) || 0)
    engine.flushOutbox().catch(() => {})
    setClosedInfo(
      t('session.theoretical', { amount: fmtUZS(Number(closed.closing_balance_theoretical ?? 0)) }) + '\n' +
        t('session.counted', { amount: fmtUZS(Number(closed.closing_balance_actual ?? 0)) }) + '\n' +
        t('session.variance', { amount: fmtUZS(Number(closed.variance ?? 0)) })
    )
  }

  return (
    <Screen scroll maxWidth={560}>
      <Card>
        <Row label={t('session.openingBalance')} value={fmtUZS(Number(session?.opening_balance ?? 0))} />
        {summary.map((s) => (
          <Row
            key={s.paymentMethod}
            label={`${PAY_I18N[s.paymentMethod] ? t(PAY_I18N[s.paymentMethod]) : s.paymentMethod} (${s.count})`} value={fmtUZS(s.total)} />
        ))}
        {movements.map((m) => (
          <Row
            key={m.id}
            label={`${m.type === 'cash_in' ? `↓ ${t('session.in')}` : `↑ ${t('session.out')}`} · ${m.description ?? ''}${m.contactName ? ` (${m.contactName})` : ''}`}
            value={`${m.type === 'cash_in' ? '+' : '−'}${fmtUZS(m.amount)}`}
            valueColor={m.type === 'cash_in' ? theme.success : theme.danger}
          />
        ))}
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Row label={t('session.expectedCash')} value={fmtUZS(theoretical)} accent big />
      </Card>

      <View style={styles.drawerBtns}>
        <Button
          title={t('session.cashIn')}
          icon="cashIn"
          variant="secondary"
          onPress={() => setMovementType('cash_in')}
          style={styles.flex1}
        />
        <Button
          title={t('session.cashOut')}
          icon="cashOut"
          variant="secondary"
          onPress={() => setMovementType('cash_out')}
          style={styles.flex1}
        />
      </View>

      <CashMovementModal
        type={movementType}
        onClose={() => setMovementType(null)}
        onDone={() => {
          setMovementType(null)
          refresh()
          engine.flushOutbox().catch(() => {})
        }}
      />

      <Text style={[typeScale.sm, styles.label, { color: theme.textMuted }]}>{t('session.countedCash')}</Text>
      <Text style={[typeScale.moneyDisplay, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {actual ? fmtUZS(Number(actual)) : fmtUZS(0)}
      </Text>
      <View style={styles.padWrap}>
        <NumPad onKey={(k) => setActual((v) => applyNumKey(v, k))} />
      </View>

      <Text
        style={[
          typeScale.lg,
          styles.varianceText,
          { color: variance === 0 ? theme.success : variance < 0 ? theme.danger : theme.warning },
        ]}
        accessibilityLiveRegion="polite"
      >
        {variance === 0 ? t('session.balanced') : variance < 0 ? t('session.short', { amount: fmtUZS(-variance) }) : t('session.overage', { amount: fmtUZS(variance) })}
      </Text>

      <Button title={t('session.closeSession')} size="lg" fullWidth onPress={() => setConfirmClose(true)} style={styles.closeBtn} />
      <Button title={t('common.cancel')} variant="ghost" fullWidth onPress={() => navigation.goBack()} />

      <Dialog
        visible={confirmClose}
        onClose={() => setConfirmClose(false)}
        title={t('session.closeSessionTitle')}
        message={
          variance === 0
            ? t('session.drawerBalanced')
            : variance < 0
              ? t('session.drawerShort', { amount: fmtUZS(-variance) })
              : t('session.drawerOver', { amount: fmtUZS(variance) })
        }
        actions={[
          { label: t('session.keepOpen'), onPress: () => setConfirmClose(false) },
          { label: t('session.closeSession'), tone: 'primary', onPress: close },
        ]}
      />

      <Dialog
        visible={closedInfo !== null}
        onClose={() => { setClosedInfo(null); setSession(null) }}
        title={t('session.sessionClosed')}
        message={closedInfo ?? ''}
        actions={[{ label: t('common.done'), tone: 'primary', onPress: () => { setClosedInfo(null); setSession(null) } }]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  divider: { height: 1, marginVertical: spacing.xs },
  drawerBtns: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.lg },
  flex1: { flex: 1 },
  label: { marginBottom: spacing.xs },
  padWrap: { alignSelf: 'center', width: '100%', maxWidth: 380, marginTop: spacing.md },
  varianceText: { textAlign: 'center', marginTop: spacing.lg },
  closeBtn: { marginTop: spacing.lg, marginBottom: spacing.sm },
})
