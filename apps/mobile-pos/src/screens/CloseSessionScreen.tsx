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
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { CashMovementModal } from '../components/CashMovementModal'
import type { RootStackParamList } from '../navigation'

type Props = NativeStackScreenProps<RootStackParamList, 'CloseSession'>

export function CloseSessionScreen({ navigation }: Props) {
  const theme = useTheme()
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
      `Theoretical: ${fmtUZS(Number(closed.closing_balance_theoretical ?? 0))}\n` +
        `Counted: ${fmtUZS(Number(closed.closing_balance_actual ?? 0))}\n` +
        `Variance: ${fmtUZS(Number(closed.variance ?? 0))}`
    )
  }

  return (
    <Screen scroll maxWidth={560}>
      <Card>
        <Row label="Opening balance" value={fmtUZS(Number(session?.opening_balance ?? 0))} />
        {summary.map((s) => (
          <Row key={s.paymentMethod} label={`${s.paymentMethod} (${s.count})`} value={fmtUZS(s.total)} />
        ))}
        {movements.map((m) => (
          <Row
            key={m.id}
            label={`${m.type === 'cash_in' ? '↓ In' : '↑ Out'} · ${m.description ?? ''}${m.contactName ? ` (${m.contactName})` : ''}`}
            value={`${m.type === 'cash_in' ? '+' : '−'}${fmtUZS(m.amount)}`}
            valueColor={m.type === 'cash_in' ? theme.success : theme.danger}
          />
        ))}
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Row label="Expected cash" value={fmtUZS(theoretical)} accent big />
      </Card>

      <View style={styles.drawerBtns}>
        <Button
          title="Cash In"
          icon="cashIn"
          variant="secondary"
          onPress={() => setMovementType('cash_in')}
          style={styles.flex1}
        />
        <Button
          title="Cash Out"
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

      <Text style={[typeScale.sm, styles.label, { color: theme.textMuted }]}>Counted cash</Text>
      <Text style={[typeScale.moneyDisplay, { color: theme.text }]}>
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
        {variance === 0 ? 'Balanced' : variance < 0 ? `Short: ${fmtUZS(-variance)}` : `Overage: ${fmtUZS(variance)}`}
      </Text>

      <Button title="Close Session" size="lg" fullWidth onPress={() => setConfirmClose(true)} style={styles.closeBtn} />
      <Button title="Cancel" variant="ghost" fullWidth onPress={() => navigation.goBack()} />

      <Dialog
        visible={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Close session?"
        message={
          variance === 0
            ? 'Drawer is balanced.'
            : variance < 0
              ? `Drawer is SHORT by ${fmtUZS(-variance)}.`
              : `Drawer is OVER by ${fmtUZS(variance)}.`
        }
        actions={[
          { label: 'Keep open', onPress: () => setConfirmClose(false) },
          { label: 'Close session', tone: 'primary', onPress: close },
        ]}
      />

      <Dialog
        visible={closedInfo !== null}
        onClose={() => { setClosedInfo(null); setSession(null) }}
        title="Session closed"
        message={closedInfo ?? ''}
        actions={[{ label: 'Done', tone: 'primary', onPress: () => { setClosedInfo(null); setSession(null) } }]}
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
