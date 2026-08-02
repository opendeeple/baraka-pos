export type { DbAdapter } from './adapter'
export { createProductRepository, type ProductRepository, type ProductListItem, type CategoryItem, type ProductInput } from './repositories/product.repo'
export { createContactRepository, type ContactRepository, type ContactListItem, type EnqueueFn } from './repositories/contact.repo'
export { createSaleRepository, saleTotals, type SaleRepository, type CreateSaleInput, type CreateSaleResult, type SaleHistoryItem } from './repositories/sale.repo'
export { createSessionRepository, type SessionRepository, type LocalSession } from './repositories/session.repo'
export { createSettingsRepository, type SettingsRepository } from './repositories/settings.repo'
export { createHeldCartRepository, type HeldCartRepository, type HeldCart } from './repositories/heldCart.repo'
export { createReportsRepository, type ReportsRepository } from './repositories/reports.repo'

import type { DbAdapter } from './adapter'
import type { EnqueueFn } from './repositories/contact.repo'
import { createProductRepository } from './repositories/product.repo'
import { createContactRepository } from './repositories/contact.repo'
import { createSaleRepository } from './repositories/sale.repo'
import { createSessionRepository } from './repositories/session.repo'
import { createSettingsRepository } from './repositories/settings.repo'
import { createHeldCartRepository } from './repositories/heldCart.repo'
import { createReportsRepository } from './repositories/reports.repo'

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
  }
}

export type Repositories = ReturnType<typeof createRepositories>
