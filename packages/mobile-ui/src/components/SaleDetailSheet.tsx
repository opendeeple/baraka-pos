import { type ReactNode } from 'react'
import { Text } from './Text'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from '@baraka/mobile-i18n'
import { radius, spacing, type } from '@baraka/ui-tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Sheet } from './Sheet'
import { Row } from './basics'

/** Structural twin of @baraka/data's SaleReceiptData (mobile-ui doesn't
 *  depend on the data package). */
export interface SaleDetailData {
  invoiceNumber: string
  saleTime: string
  customerName: string | null
  discount: number
  total: number
  change: number
  items: Array<{ name: string; quantity: number; price: number; discount: number }>
  payments: Array<{ method: string; amount: number }>
}

export interface SaleDetailSheetProps {
  data: SaleDetailData | null
  onClose: () => void
  /** Money formatter from the app (fmtUZS) — kept injectable so this kit
   *  stays free of app-core. */
  formatMoney: (n: number) => string
  /** Optional action row (e.g. Print / PDF) pinned at the bottom. */
  footer?: ReactNode
}

const METHOD_I18N: Record<string, string> = {
  Cash: 'payment.methodCash',
  Card: 'payment.methodCard',
  Click: 'payment.methodClick',
  Debt: 'payment.methodDebt',
}

/** What was bought in one sale: line items, discount, total, payments. */
export function SaleDetailSheet({ data, onClose, formatMoney, footer }: SaleDetailSheetProps) {
  const theme = useTheme()
  const { t } = useTranslation()

  return (
    <Sheet visible={data !== null} onClose={onClose} title={data?.invoiceNumber} footer={footer} scrollBody>
      {data && (
        <View style={styles.body}>
          <Text style={[type.sm, { color: theme.textMuted }]}>
            {String(data.saleTime).slice(0, 16).replace('T', ' ')}
            {data.customerName ? ` · ${t('saleDetail.customer')}: ${data.customerName}` : ''}
          </Text>

          <Text style={[type.sm, styles.section, { color: theme.textMuted }]}>{t('saleDetail.items')}</Text>
          {data.items.length === 0 ? (
            <Text style={[type.sm, { color: theme.textFaint }]}>{t('saleDetail.noItems')}</Text>
          ) : (
            data.items.map((it, i) => (
              <View key={i} style={[styles.item, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
                <View style={styles.itemMid}>
                  <Text style={[type.sm, { color: theme.text, fontWeight: '600' }]} numberOfLines={2}>
                    {it.name}
                  </Text>
                  <Text style={[type.xs, { color: theme.textFaint }]}>
                    {t('saleDetail.qtyPrice', { qty: it.quantity, price: formatMoney(it.price) })}
                    {it.discount > 0 ? ` · −${formatMoney(it.discount)}` : ''}
                  </Text>
                </View>
                <Text style={[type.money, styles.itemTotal, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatMoney(it.quantity * it.price - (it.discount || 0))}
                </Text>
              </View>
            ))
          )}

          <View style={[styles.totals, { borderTopColor: theme.border }]}>
            {data.discount > 0 && <Row label={t('saleDetail.discount')} value={`−${formatMoney(data.discount)}`} />}
            <Row label={t('saleDetail.total')} value={formatMoney(data.total)} big />
          </View>

          {data.payments.length > 0 && (
            <>
              <Text style={[type.sm, styles.section, { color: theme.textMuted }]}>{t('saleDetail.payments')}</Text>
              {data.payments.map((p, i) => (
                <Row
                  key={i}
                  label={METHOD_I18N[p.method] ? t(METHOD_I18N[p.method]) : p.method}
                  value={formatMoney(p.amount)}
                  valueColor={p.method === 'Debt' ? theme.warning : undefined}
                />
              ))}
              {data.change > 0 && (
                <Row label={t('saleDetail.change')} value={formatMoney(data.change)} valueColor={theme.success} />
              )}
            </>
          )}
        </View>
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.xs, paddingBottom: spacing.sm },
  section: { fontWeight: '600', marginTop: spacing.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  itemMid: { flex: 1, minWidth: 0, gap: 2 },
  itemTotal: { flexShrink: 0, maxWidth: '45%' },
  totals: { borderTopWidth: 1, marginTop: spacing.sm, paddingTop: spacing.sm, gap: spacing.xs },
})
