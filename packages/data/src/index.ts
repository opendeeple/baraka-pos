export type { DbAdapter } from './adapter'
export { createProductRepository, type ProductRepository, type ProductListItem, type CategoryItem, type ProductInput } from './repositories/product.repo'
export { createContactRepository, type ContactRepository, type ContactListItem, type EnqueueFn } from './repositories/contact.repo'
export { createSaleRepository, saleTotals, type SaleRepository, type CreateSaleInput, type CreateSaleResult, type SaleHistoryItem, type SaleItemRow } from './repositories/sale.repo'
export { createSessionRepository, type SessionRepository, type LocalSession } from './repositories/session.repo'
export { createSettingsRepository, type SettingsRepository } from './repositories/settings.repo'
export { createHeldCartRepository, type HeldCartRepository, type HeldCart } from './repositories/heldCart.repo'
export { createReportsRepository, type ReportsRepository } from './repositories/reports.repo'
export { createExpenseRepository, type ExpenseRepository, type ExpenseItem, type CreateExpenseInput } from './repositories/expense.repo'
export { createWarehouseRepository, type WarehouseRepository, type WarehouseStockRow, type StockLocation, type StockMoveKind } from './repositories/warehouse.repo'
export { createPurchaseRepository, type PurchaseRepository, type PurchaseListItem, type PurchaseItemRow, type OrderLineInput, type ReceiveCheck } from './repositories/purchase.repo'
export { logAudit, type AuditAction } from './repositories/audit'
export { createCategoryRepository, type CategoryRepository, type CategoryRow } from './repositories/category.repo'

import type { DbAdapter } from './adapter'
import type { EnqueueFn } from './repositories/contact.repo'
import { createProductRepository } from './repositories/product.repo'
import { createContactRepository } from './repositories/contact.repo'
import { createSaleRepository } from './repositories/sale.repo'
import { createSessionRepository } from './repositories/session.repo'
import { createSettingsRepository } from './repositories/settings.repo'
import { createHeldCartRepository } from './repositories/heldCart.repo'
import { createReportsRepository } from './repositories/reports.repo'
import { createExpenseRepository } from './repositories/expense.repo'
import { createWarehouseRepository } from './repositories/warehouse.repo'
import { createPurchaseRepository } from './repositories/purchase.repo'
import { createCategoryRepository } from './repositories/category.repo'

/** Convenience: build all repositories over one adapter. */
export function createRepositories(db: DbAdapter, uuid: () => string, enqueue: EnqueueFn) {
  return {
    products: createProductRepository(db, uuid, enqueue),
    contacts: createContactRepository(db, uuid, enqueue),
    sales: createSaleRepository(db, uuid, enqueue),
    sessions: createSessionRepository(db, uuid, enqueue),
    settings: createSettingsRepository(db),
    heldCarts: createHeldCartRepository(db, uuid),
    reports: createReportsRepository(db),
    expenses: createExpenseRepository(db, uuid, enqueue),
    warehouse: createWarehouseRepository(db, uuid, enqueue),
    purchases: createPurchaseRepository(db, uuid, enqueue),
    categories: createCategoryRepository(db, uuid, enqueue),
  }
}

export type Repositories = ReturnType<typeof createRepositories>
