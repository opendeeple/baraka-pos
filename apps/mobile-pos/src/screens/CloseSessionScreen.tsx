import { useCallback, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { fmtUZS } from '@baraka/app-core'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { NumPad, applyNumKey } from '../components/NumPad'
import { CashMovementModal } from '../components/CashMovementModal'
import { colors } from '../theme'
import type { RootStackParamList } from '../navigation'

type Props = NativeStackScreenProps<RootStackParamList, 'CloseSession'>

export function CloseSessionScreen({ navigation }: Props) {
  const { repos, engine } = getServices()
  const { session, setSession } = useAuthStore()
  const [actual, setActual] = useState('')
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out' | null>(null)
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
    const closed = repos.sessions.close(session.id, Number(actual) || 0)
    engine.flushOutbox().catch(() => {})
    setSession(null)
    Alert.alert(
      'Session closed',
      `Theoretical: ${fmtUZS(Number(closed.closing_balance_theoretical ?? 0))}\nCounted: ${fmtUZS(Number(closed.closing_balance_actual ?? 0))}\nVariance: ${fmtUZS(Number(closed.variance ?? 0))}`
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Close Register</Text>

      <View style={styles.card}>
        <Row label="Opening balance" value={fmtUZS(Number(session?.opening_balance ?? 0))} />
        {summary.map((s) => (
          <Row key={s.paymentMethod} label={`${s.paymentMethod} (${s.count})`} value={fmtUZS(s.total)} />
        ))}
        {movements.map((m) => (
          <Row
            key={m.id}
            label={`${m.type === 'cash_in' ? '↓ In' : '↑ Out'} · ${m.description ?? ''}${m.contactName ? ` (${m.contactName})` : ''}`}
            value={`${m.type === 'cash_in' ? '+' : '−'}${fmtUZS(m.amount)}`}
          />
        ))}
        <View style={styles.divider} />
        <Row label="Expected cash" value={fmtUZS(theoretical)} accent />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <TouchableOpacity style={[styles.drawerBtn, { borderColor: colors.success }]} onPress={() => setMovementType('cash_in')}>
          <Text style={[styles.drawerBtnText, { color: colors.success }]}>↓ Cash In</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.drawerBtn, { borderColor: colors.danger }]} onPress={() => setMovementType('cash_out')}>
          <Text style={[styles.drawerBtnText, { color: colors.danger }]}>↑ Cash Out</Text>
        </TouchableOpacity>
      </View>

      <CashMovementModal
        type={movementType}
        onClose={() => setMovementType(null)}
        onDone={() => { setMovementType(null); refresh(); engine.flushOutbox().catch(() => {}) }}
      />

      <Text style={styles.label}>Counted cash</Text>
      <Text style={styles.amount}>{actual ? fmtUZS(Number(actual)) : '0.00'}</Text>
      <View style={styles.padWrap}>
        <NumPad onKey={(k) => setActual((v) => applyNumKey(v, k))} />
      </View>

      <Text style={[styles.varianceText, { color: variance === 0 ? colors.success : variance < 0 ? colors.danger : colors.primary }]}>
        {variance === 0 ? 'Balanced' : variance < 0 ? `Short: ${fmtUZS(-variance)}` : `Overage: ${fmtUZS(variance)}`}
      </Text>

      <TouchableOpacity style={styles.button} onPress={close}>
        <Text style={styles.buttonText}>Close Session</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancel} onPress={() => navigation.goBack()}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, accent && { color: colors.primary }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { color: colors.text, fontSize: 22, fontWeight: 'bold', marginBottom: 14 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 8, marginBottom: 16 },
  drawerBtn: {
    flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', minHeight: 46, justifyContent: 'center',
  },
  drawerBtnText: { fontWeight: '700', fontSize: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: colors.textMuted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  label: { color: colors.textMuted, fontSize: 13, marginBottom: 4 },
  amount: { color: colors.text, fontSize: 30, fontWeight: '800', marginBottom: 12 },
  padWrap: { alignSelf: 'center', width: '100%', maxWidth: 380 },
  varianceText: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 14 },
  button: {
    backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15,
    alignItems: 'center', marginTop: 16, minHeight: 50, justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancel: { alignItems: 'center', marginTop: 12 },
  cancelText: { color: colors.textMuted },
})
