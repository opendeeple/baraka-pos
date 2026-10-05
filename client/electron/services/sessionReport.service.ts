import { dbQuery } from './db.service'

// One place that knows how much cash a till session should hold — used by
// the close (stored as closing_balance_theoretical), the close screen, and
// the printed X (mid-shift) and Z (closing) reports, so they always agree.
//
// Conventions it has to bridge:
// - payment_transactions.amount is what the customer handed over; the change
//   given back (sales.change_amount) always leaves the drawer as cash.
// - refunds are payment rows with transaction_type 'return' and a negative amount.
// - cash_logs signs differ by writer (expenses are stored negative, Android
//   writes positive amounts with cash_in/cash_out), so movements are taken
//   by source with ABS().
// - a cancelled (voided) sale moves no money at all.

export interface SessionReport {
  sessionId: number
  terminalId: string | null
  openedAt: string | null
  closedAt: string | null
  openingBalance: number
  saleCount: number
  salesTotal: number
  returnCount: number
  cancelledCount: number
  /** Per payment method, sales minus refunds; cash net of change given. */
  byMethod: Array<{ method: string; amount: number }>
  cashSales: number
  cashRefunds: number
  debtRepaymentsCash: number
  deposits: number
  withdrawals: number
  expensesCash: number
  supplierPaymentsCash: number
  expectedCash: number
  closingBalanceActual: number | null
}

const n = (v: unknown) => Number(v ?? 0) || 0

export function buildSessionReport(sessionId: number): SessionReport {
  const session = dbQuery(`SELECT * FROM pos_sessions WHERE id=?`, [sessionId])[0] as {
    id: number; terminal_id: string | null; opening_balance: number; opened_at: string | null
    closed_at: string | null; closing_balance_actual: number | null
  } | undefined
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const sales = dbQuery(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total, COALESCE(SUM(change_amount),0) AS change
     FROM sales WHERE session_id=? AND status != 'cancelled' AND COALESCE(sale_type,'sale') = 'sale'`,
    [sessionId]
  )[0] as { cnt: number; total: number; change: number }
  const returns = dbQuery(
    `SELECT COUNT(*) AS cnt FROM sales WHERE session_id=? AND status != 'cancelled' AND sale_type = 'return'`, [sessionId]
  )[0] as { cnt: number }
  const cancelled = dbQuery(
    `SELECT COUNT(*) AS cnt FROM sales WHERE session_id=? AND status = 'cancelled'`, [sessionId]
  )[0] as { cnt: number }

  const payments = dbQuery(
    `SELECT pt.payment_method AS method, pt.transaction_type AS type, COALESCE(SUM(pt.amount),0) AS amount
     FROM payment_transactions pt JOIN sales s ON s.id = pt.sale_id
     WHERE pt.session_id=? AND s.status != 'cancelled'
     GROUP BY pt.payment_method, pt.transaction_type`,
    [sessionId]
  ) as Array<{ method: string; type: string; amount: number }>

  const change = n(sales.change)
  const totals = new Map<string, number>()
  let cashTendered = 0, cashRefunds = 0
  for (const p of payments) {
    totals.set(p.method, (totals.get(p.method) ?? 0) + n(p.amount))
    if (p.method === 'Cash' && p.type === 'sale') cashTendered += n(p.amount)
    if (p.method === 'Cash' && p.type === 'return') cashRefunds += Math.abs(n(p.amount))
  }
  if (totals.has('Cash')) totals.set('Cash', (totals.get('Cash') ?? 0) - change)
  const cashSales = cashTendered - change

  const moves = dbQuery(
    `SELECT source, contact_id IS NOT NULL AS has_contact, COALESCE(payment_method,'Cash') AS method,
            COALESCE(SUM(ABS(amount)),0) AS amount
     FROM cash_logs WHERE session_id=? GROUP BY source, has_contact, method`,
    [sessionId]
  ) as Array<{ source: string; has_contact: number; method: string; amount: number }>
  const sum = (pred: (m: typeof moves[number]) => boolean) => moves.filter(pred).reduce((s, m) => s + n(m.amount), 0)
  const deposits = sum((m) => m.source === 'deposit' && !m.has_contact)
  const debtRepaymentsCash = sum((m) => (m.source === 'deposit' || m.source === 'debt_payment') && !!m.has_contact && m.method === 'Cash')
  const withdrawals = sum((m) => m.source === 'withdrawal')
  const expensesCash = sum((m) => m.source === 'expense')
  const supplierPaymentsCash = sum((m) => m.source === 'purchase' && m.method === 'Cash')

  const opening = n(session.opening_balance)
  const expectedCash = opening + cashSales - cashRefunds + debtRepaymentsCash + deposits - withdrawals - expensesCash - supplierPaymentsCash

  return {
    sessionId,
    terminalId: session.terminal_id,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    openingBalance: opening,
    saleCount: n(sales.cnt),
    salesTotal: n(sales.total),
    returnCount: n(returns.cnt),
    cancelledCount: n(cancelled.cnt),
    byMethod: [...totals.entries()].map(([method, amount]) => ({ method, amount })),
    cashSales,
    cashRefunds,
    debtRepaymentsCash,
    deposits,
    withdrawals,
    expensesCash,
    supplierPaymentsCash,
    expectedCash,
    closingBalanceActual: session.closing_balance_actual == null ? null : n(session.closing_balance_actual),
  }
}
