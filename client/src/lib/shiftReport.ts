import type { TFunction } from 'i18next'
import type { ReportDoc, ReportLine, SessionReport } from '../types/electron'
import { fmtUZS } from './currency'

export function methodLabel(t: TFunction, method: string): string {
  const key: Record<string, string> = {
    Cash: 'payment.methodCash', Card: 'payment.methodCard', Click: 'payment.methodClick', Debt: 'payment.methodDebt',
  }
  return key[method] ? t(key[method]) : method
}

/** The drawer's cash movements, top to bottom, as the close screen and the printed reports show them. */
export function cashFlowRows(t: TFunction, r: SessionReport): Array<{ label: string; amount: number; sign: '+' | '-' | '' }> {
  return [
    { label: t('shift.opening'), amount: r.openingBalance, sign: '' as const },
    { label: t('shift.cashSales'), amount: r.cashSales, sign: '+' as const },
    { label: t('shift.cashRefunds'), amount: r.cashRefunds, sign: '-' as const },
    { label: t('shift.debtRepayments'), amount: r.debtRepaymentsCash, sign: '+' as const },
    { label: t('shift.deposits'), amount: r.deposits, sign: '+' as const },
    { label: t('shift.withdrawals'), amount: r.withdrawals, sign: '-' as const },
    { label: t('shift.expenses'), amount: r.expensesCash, sign: '-' as const },
    { label: t('shift.supplierPayments'), amount: r.supplierPaymentsCash, sign: '-' as const },
  ].filter((row) => row.sign === '' || row.amount !== 0)
}

/** X = mid-shift snapshot (nothing closes), Z = the closing report with the counted cash. */
export function shiftReportDoc(t: TFunction, r: SessionReport, kind: 'X' | 'Z', storeName: string, counted?: number): ReportDoc {
  const lines: ReportLine[] = [
    { label: t('shift.terminal'), value: r.terminalId ?? '—' },
    { label: t('shift.openedAt'), value: r.openedAt ? new Date(r.openedAt).toLocaleString().slice(0, 17) : '—' },
    { divider: true },
    { label: t('shift.saleCount'), value: String(r.saleCount) },
    { label: t('shift.salesTotal'), value: fmtUZS(r.salesTotal), bold: true },
    { label: t('shift.returnCount'), value: String(r.returnCount) },
    { label: t('shift.cancelledCount'), value: String(r.cancelledCount) },
    { divider: true },
    { label: t('shift.byMethod'), bold: true },
    ...r.byMethod.map((m) => ({ label: methodLabel(t, m.method), value: fmtUZS(m.amount) })),
    { divider: true },
    { label: t('shift.cashFlow'), bold: true },
    ...cashFlowRows(t, r).map((row) => ({ label: row.label, value: `${row.sign}${fmtUZS(row.amount)}` })),
    { label: t('shift.expected'), value: fmtUZS(r.expectedCash), bold: true },
  ]
  if (kind === 'Z' && counted !== undefined) {
    const diff = counted - r.expectedCash
    lines.push(
      { label: t('shift.counted'), value: fmtUZS(counted), bold: true },
      { label: diff >= 0 ? t('shift.over') : t('shift.short'), value: `${diff >= 0 ? '+' : ''}${fmtUZS(diff)}`, bold: true },
    )
  }
  return { title: kind === 'X' ? t('shift.xReport') : t('shift.zReport'), subtitle: storeName, lines }
}
