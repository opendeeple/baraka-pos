// Creditors ("haqdorlar"): money taken from customers, owed back by a due
// date. Dates are local 'YYYY-MM-DD' (schema v18).

export type CreditorCurrency = 'UZS' | 'USD'

export function todayYmd(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Whole days from today to `ymd`; negative once it has passed. Same rule as creditorReminder.service.ts. */
export function daysUntil(ymd: string, today = todayYmd()): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(ymd) - toUtc(today)) / 86_400_000)
}

export function fmtCreditorAmount(amount: number, currency: string): string {
  return currency === 'USD'
    ? `$ ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `UZS ${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

/** SQL: open creditors that are due within their reminder window, today, or overdue. */
export const CREDITORS_ATTENTION_SQL = `SELECT COUNT(*) AS n FROM creditors
  WHERE status = 'open' AND deleted_at IS NULL
    AND due_date <= date('now', 'localtime', '+' || COALESCE(remind_days, 0) || ' days')`
