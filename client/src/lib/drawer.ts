// Whether the till's cash drawer should pop open by itself for a given kind
// of cash movement — each kind is its own setting (Settings > Printer), so
// the owner can turn any one of them off without affecting the others.
// All default on: popping the drawer whenever cash physically changes hands
// is the safe default, and matches the behavior a cash sale already had
// before this became configurable.
export type DrawerTrigger = 'sale' | 'debtPayment' | 'expense' | 'supplierPayment'

const SETTING_KEY: Record<DrawerTrigger, string> = {
  sale: 'auto_drawer_sale_config',
  debtPayment: 'auto_drawer_debt_payment_config',
  expense: 'auto_drawer_expense_config',
  supplierPayment: 'auto_drawer_supplier_payment_config',
}

export async function shouldAutoOpenDrawer(trigger: DrawerTrigger): Promise<boolean> {
  const [row] = await window.electronAPI.db.query(
    `SELECT meta_value FROM settings WHERE meta_key=? LIMIT 1`, [SETTING_KEY[trigger]]
  ) as Array<{ meta_value: string }>
  if (!row) return true
  try { return Boolean(JSON.parse(row.meta_value)?.enabled ?? true) } catch { return true }
}

/** Best-effort: a drawer that fails to open is a printer/wiring problem, never a reason to roll back the cash movement it followed. */
export function autoOpenDrawer(trigger: DrawerTrigger, onError?: (message: string) => void): void {
  shouldAutoOpenDrawer(trigger).then((enabled) => {
    if (!enabled) return
    window.electronAPI.printer.openCashDrawer()
      .then((r) => { if (!r.success) onError?.(r.error || '') })
      .catch(() => onError?.(''))
  })
}
