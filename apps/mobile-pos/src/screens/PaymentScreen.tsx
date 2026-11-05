import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { fmtUZS, renderReceiptText, type ReceiptDoc } from '@baraka/app-core'
import type { PaymentMethod } from '@baraka/shared'
import type { ContactListItem } from '@baraka/data'
import {
  Button,
  Card,
  Chip,
  Dialog,
  IconButton,
  NumPad,
  Row,
  Screen,
  Sheet,
  applyNumKey,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { radius, spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { CustomerPickerModal } from '../components/CustomerPickerModal'
import { printReceipt, printViaSystemDialog, shareReceiptPdf, type PrinterConfig } from '../printing'
import type { RootStackParamList } from '../navigation'

type Props = NativeStackScreenProps<RootStackParamList, 'Payment'>

const METHODS = ['Cash', 'Card', 'Click', 'Debt'] as const
const METHOD_I18N: Record<(typeof METHODS)[number], string> = {
  Cash: 'payment.methodCash',
  Card: 'payment.methodCard',
  Click: 'payment.methodClick',
  Debt: 'payment.methodDebt',
}

// Likely banknote hand-overs for the amount due: the total rounded UP to the
// next multiple of each denomination, deduped (adapted from Lakasir).
const DENOMINATIONS = [1000, 5000, 10000, 20000, 50000, 100000]
function suggestedCash(due: number): number[] {
  const suggestions = new Set<number>()
  for (const d of DENOMINATIONS) {
    suggestions.add(Math.ceil(due / d) * d)
  }
  return [...suggestions].filter((v) => v >= due).sort((a, b) => a - b).slice(0, 5)
}

export function PaymentScreen({ navigation }: Props) {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos, engine, useCartStore } = getServices()
  const cart = useCartStore()
  const { user, store, session } = useAuthStore()

  const total = cart.getFinalTotal()
  const [payments, setPayments] = useState<Array<{ paymentMethod: PaymentMethod; amount: number }>>([])
  const [method, setMethod] = useState<(typeof METHODS)[number]>('Cash')
  const [entry, setEntry] = useState('')
  const [processing, setProcessing] = useState(false)
  const [customer, setCustomer] = useState<ContactListItem | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [largeAmount, setLargeAmount] = useState<number | null>(null)
  const [receipt, setReceipt] = useState<{ doc: ReceiptDoc; change: number } | null>(null)
  const [receiptBusy, setReceiptBusy] = useState<'print' | 'pdf' | null>(null)

  const hasDebt = payments.some((p) => p.paymentMethod === 'Debt') || method === 'Debt'

  const paid = payments.reduce((s, p) => s + p.amount, 0)
  const remaining = Math.max(0, total - paid)
  const change = Math.max(0, paid - total)
  const fullyPaid = paid >= total && total > 0

  function addPayment(amount?: number) {
    // Empty manual entry means "exact remaining" — matches how the reference
    // POS apps behave and saves a tap on the most common flow.
    const value = amount ?? (entry ? Number(entry) : remaining)
    if (!value || value <= 0) return
    // Only cash can exceed what's due (the rest is change from the drawer).
    // Card, Click and debt settle exactly what they cover: a debt keyed above
    // the bill would charge the customer for goods they never took.
    if (method !== 'Cash' && value > remaining + 0.005) {
      toast.error(t('payment.nonCashOverRemaining', { method: t(METHOD_I18N[method]), amount: fmtUZS(remaining) }))
      return
    }
    // Fat-finger guard (Odoo's large-amount check): a manually keyed amount
    // wildly above what's due is almost always a missed decimal or extra zero.
    if (amount === undefined && entry && total > 0 && value > total * 100) {
      setLargeAmount(value)
      return
    }
    setPayments((prev) => [...prev, { paymentMethod: method, amount: value }])
    setEntry('')
  }

  async function complete() {
    if (!fullyPaid || processing) return
    // Debt sales must be attached to a customer whose balance carries the debt.
    if (payments.some((p) => p.paymentMethod === 'Debt') && !customer) {
      toast.error(t('payment.selectCustomerForDebt'))
      setPickerOpen(true)
      return
    }
    setProcessing(true)
    try {
      const invoiceNumber =
        engine.nextInvoiceNumber() ?? `INV-${Math.random().toString(16).slice(2, 10).toUpperCase()}`
      const result = repos.sales.createSale({
        storeId: store?.id ?? 1,
        sessionId: session?.id ?? 1,
        userId: user?.id ?? 1,
        contactId: customer?.id ?? null,
        items: cart.items,
        charges: cart.charges,
        discount: cart.discount,
        payments,
        invoiceNumber,
      })
      const doc: ReceiptDoc = {
        invoiceNumber: result.invoiceNumber,
        storeName: store?.name ?? t('receipt.storeFallback'),
        storeAddress: store?.address,
        storePhone: store?.phone,
        cashierName: user?.name ?? t('receipt.cashierFallback'),
        timestamp: new Date().toISOString(),
        items: cart.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          price: i.unitPrice,
          discount: i.discount,
        })),
        charges: [],
        discount: cart.discount,
        total: result.total,
        payments: payments.map((p) => ({ method: p.paymentMethod, amount: p.amount })),
        change: result.changeAmount,
        openDrawer: payments.some((p) => p.paymentMethod === 'Cash'),
      }
      const printerConfig = repos.settings.getJson<PrinterConfig>('printer_config')
      printReceipt(doc, printerConfig).catch(() => {
        // A failed print must never be invisible at the counter.
        toast.error(t('receipt.printFailed'))
      })
      cart.clearCart()
      engine.flushOutbox().catch(() => {})
      setReceipt({ doc, change: result.changeAmount })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('payment.paymentFailed'))
    } finally {
      setProcessing(false)
    }
  }

  // Manual fallback independent of printer_config — useful on its own when
  // no network/Bluetooth printer is set up, and always available even when
  // one is: Android's system print dialog lists every print-capable app on
  // the phone (a thermal printer's own vendor app included, if it registers
  // as a print service), so this works without BarakaPOS needing its own
  // driver for whatever printer the shop actually has.
  async function printNow() {
    if (!receipt || receiptBusy) return
    setReceiptBusy('print')
    try {
      await printViaSystemDialog(receipt.doc)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('payment.printFailed'))
    } finally {
      setReceiptBusy(null)
    }
  }

  async function sharePdf() {
    if (!receipt || receiptBusy) return
    setReceiptBusy('pdf')
    try {
      await shareReceiptPdf(receipt.doc)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('payment.pdfFailed'))
    } finally {
      setReceiptBusy(null)
    }
  }

  return (
    <Screen scroll maxWidth={560}>
      <Card>
        <Row label={t('payment.total')} value={fmtUZS(total)} big />
        <Row label={t('payment.paid')} value={fmtUZS(paid)} />
        <Row
          label={change > 0 ? t('payment.change') : t('payment.remaining')}
          value={fmtUZS(change > 0 ? change : remaining)}
          accent
          valueColor={change > 0 ? theme.success : undefined}
        />
      </Card>

      <View style={styles.methods}>
        {METHODS.map((m) => (
          <Chip
            key={m}
            label={t(METHOD_I18N[m])}
            selected={method === m}
            onPress={() => {
              setMethod(m)
              if (m === 'Debt' && !customer) setPickerOpen(true)
            }}
          />
        ))}
      </View>

      <View style={styles.customerRow}>
        <Button
          title={
            customer
              ? customer.name
              : hasDebt
                ? t('payment.selectCustomerDebt')
                : t('payment.selectCustomer')
          }
          variant="secondary"
          icon="user"
          size="sm"
          onPress={() => setPickerOpen(true)}
          style={[styles.flex1, hasDebt && !customer ? { borderColor: theme.danger, borderWidth: 1 } : null]}
        />
        {customer && (
          <IconButton icon="x" accessibilityLabel={t('payment.clearCustomer')} color={theme.danger} onPress={() => setCustomer(null)} />
        )}
      </View>

      <CustomerPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(c) => { setCustomer(c); setPickerOpen(false) }}
      />

      {method === 'Cash' && remaining > 0 && (
        <View style={styles.denomRow}>
          {suggestedCash(remaining).map((d) => (
            <Chip key={d} label={d >= 1000 ? `${d / 1000}k` : String(d)} onPress={() => addPayment(d)} />
          ))}
        </View>
      )}

      <Text
        style={[typeScale.moneyDisplay, styles.entry, { color: entry ? theme.text : theme.textFaint }]}
        accessibilityLabel={`${fmtUZS(Number(entry) || remaining)}`}
      >
        {entry ? fmtUZS(Number(entry)) : fmtUZS(remaining)}
      </Text>
      <View style={styles.padWrap}>
        <NumPad onKey={(k) => setEntry((v) => applyNumKey(v, k))} />
      </View>

      <View style={styles.quickRow}>
        <Button title={t('payment.exact')} variant="secondary" onPress={() => addPayment(remaining)} style={styles.flex1} />
        <Button title={t('payment.addPayment', { method: t(METHOD_I18N[method]) })} onPress={() => addPayment()} style={styles.flex2} />
      </View>

      {payments.map((p, i) => (
        <View key={i} style={[styles.paymentRow, { backgroundColor: theme.surfaceRaised }]}>
          <Text style={[typeScale.md, { color: theme.text, fontWeight: '600' }]}>{t(METHOD_I18N[p.paymentMethod as keyof typeof METHOD_I18N] ?? p.paymentMethod)}</Text>
          <View style={styles.paymentRight}>
            <Text style={[typeScale.money, { color: theme.text }]}>{fmtUZS(p.amount)}</Text>
            <IconButton
              icon="x"
              size={20}
              accessibilityLabel={t('payment.removePayment', { method: p.paymentMethod })}
              color={theme.danger}
              onPress={() => setPayments((prev) => prev.filter((_, j) => j !== i))}
            />
          </View>
        </View>
      ))}

      <Button
        title={processing ? t('payment.processing') : t('payment.completeSale')}
        variant="success"
        size="lg"
        fullWidth
        loading={processing}
        disabled={!fullyPaid}
        onPress={complete}
        style={styles.completeBtn}
        testID="complete-sale"
      />

      <Dialog
        visible={largeAmount !== null}
        onClose={() => setLargeAmount(null)}
        title={t('payment.largeAmountTitle')}
        message={largeAmount !== null ? t('payment.largeAmountMessage', { amount: fmtUZS(largeAmount), total: fmtUZS(total) }) : ''}
        actions={[
          { label: t('common.cancel'), onPress: () => setLargeAmount(null) },
          {
            label: t('payment.add'),
            tone: 'primary',
            onPress: () => {
              if (largeAmount !== null) {
                setPayments((prev) => [...prev, { paymentMethod: method, amount: largeAmount }])
                setEntry('')
              }
              setLargeAmount(null)
            },
          },
        ]}
      />

      {/* Post-sale receipt: on-screen preview of exactly what printed. */}
      <Sheet
        visible={receipt !== null}
        onClose={() => { setReceipt(null); navigation.goBack() }}
        title={t('payment.saleComplete')}
        // Long receipts used to push Print/PDF/Done off the bottom of the
        // capped sheet — the receipt now scrolls and the actions stay pinned.
        footer={
          receipt ? (
            <>
            <View style={styles.receiptActions}>
              <Button
                title={t('payment.print')}
                variant="secondary"
                icon="printer"
                loading={receiptBusy === 'print'}
                disabled={receiptBusy !== null && receiptBusy !== 'print'}
                onPress={printNow}
                style={styles.flex1}
              />
              <Button
                title={t('payment.savePdf')}
                variant="secondary"
                icon="send"
                loading={receiptBusy === 'pdf'}
                disabled={receiptBusy !== null && receiptBusy !== 'pdf'}
                onPress={sharePdf}
                style={styles.flex1}
              />
            </View>
            <Button
              title={t('common.done')}
              size="lg"
              fullWidth
              onPress={() => { setReceipt(null); navigation.goBack() }}
              style={styles.doneBtn}
              testID="receipt-done"
            />
            </>
          ) : undefined
        }
      >
        {receipt && (
          <>
            {receipt.change > 0 && (
              <Card style={styles.changeCard}>
                <Row label={t('payment.changeDue')} value={fmtUZS(receipt.change)} big valueColor={theme.success} />
              </Card>
            )}
            <View style={[styles.receiptBox, { backgroundColor: theme.bg, borderColor: theme.border }]}>
              <Text style={[styles.receiptText, { color: theme.textMuted }]}>
                {renderReceiptText(receipt.doc, 32)}
              </Text>
            </View>
          </>
        )}
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  methods: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  denomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  entry: { textAlign: 'center', marginBottom: spacing.md },
  padWrap: { alignSelf: 'center', width: '100%', maxWidth: 380 },
  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
  paymentRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  completeBtn: { marginTop: spacing.xl },
  changeCard: { marginBottom: spacing.sm },
  receiptActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  receiptBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  receiptText: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  doneBtn: { marginTop: spacing.md },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
