// Debt history only counts rows newer than the contact's latest clearance
// (debt_clearances, schema v12) — clearing a paid-off debt records a cut-off
// instead of deleting sales/cash_logs. '' sorts before any ISO timestamp, so
// a contact that was never cleared sees their whole history.

/** SQL expression: the cut-off timestamp for the contact whose id is `contactIdExpr`. */
export function lastClearedSql(contactIdExpr: string): string {
  return `COALESCE((SELECT MAX(dc.cleared_at) FROM debt_clearances dc WHERE dc.contact_id = ${contactIdExpr}), '')`
}

/**
 * SQL condition on a `cash_logs` row: a debt repayment by the contact bound
 * to the two `?` params (pass the contact id twice). Desktop records them as
 * 'debt_payment'; ones pulled from other devices arrive as 'deposit' (the
 * server's name for a cash-in against a customer). The reference_id branch
 * catches old desktop rows written before contact_id existed.
 */
export const REPAYMENT_FOR_CONTACT = `(transaction_type = 'cash_in' AND source IN ('debt_payment', 'deposit')
  AND (contact_id = ? OR (contact_id IS NULL AND source = 'debt_payment' AND reference_id = ?)))`

/**
 * SQL condition on a `contacts c` row: still owes money, OR has paid off but
 * its debt history hasn't been cleared yet — those stay in the debtors list
 * until someone deletes the debt.
 */
export const OPEN_DEBT_CONDITION = `(c.balance > 0 OR EXISTS (
  SELECT 1 FROM sales s
  JOIN payment_transactions pt ON pt.sale_id = s.id AND pt.payment_method = 'Debt'
  WHERE s.contact_id = c.id AND s.status != 'cancelled' AND s.created_at > ${lastClearedSql('c.id')}
))`

/** Local `YYYY-MM-DD HH:mm` — "when" for a repayment, not just the day. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ')
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
