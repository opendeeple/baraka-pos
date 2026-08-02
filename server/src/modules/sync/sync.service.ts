import { prisma } from '../../config/database'
import { SyncEntityType } from '@baraka/shared'
import { SaleCheckoutRequest } from '@baraka/shared'
import dayjs from 'dayjs'

const TABLE_MAP: Record<SyncEntityType, () => Promise<unknown[]>> = {
  products: () =>
    prisma.product.findMany({ where: { deletedAt: null } }),
  product_batches: () =>
    prisma.productBatch.findMany({ where: { deletedAt: null } }),
  product_stocks: () => prisma.productStock.findMany(),
  contacts: () => prisma.contact.findMany({ where: { deletedAt: null } }),
  collections: () => prisma.collection.findMany(),
  collection_product: () => prisma.collectionProduct.findMany(),
  charges: () => prisma.charge.findMany({ where: { isActive: true } }),
  settings: () => prisma.setting.findMany(),
  stores: () => prisma.store.findMany({ where: { deletedAt: null } }),
}

export async function pullTable(table: SyncEntityType, storeId: number, lastSync?: string) {
  const records = await TABLE_MAP[table]()
  return {
    table,
    records,
    serverTime: dayjs().toISOString(),
  }
}

export async function pushSales(
  storeId: number,
  terminalId: string,
  sales: SaleCheckoutRequest[]
) {
  const synced: Array<{ syncId: string; serverId: number; invoiceNumber: string }> = []
  const errors: Array<{ syncId: string; error: string }> = []

  for (const sale of sales) {
    try {
      // Idempotency: skip if already synced
      const existing = await prisma.sale.findUnique({ where: { syncId: sale.syncId } })
      if (existing) {
        synced.push({
          syncId: sale.syncId,
          serverId: existing.id,
          invoiceNumber: existing.invoiceNumber,
        })
        continue
      }

      const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } })
      const invoiceNumber = `${store.salePrefix}-${String(store.currentSaleNumber + 1).padStart(6, '0')}`

      // Calculate totals
      const subtotal = sale.items.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0
      )
      const totalChargeAmount = sale.charges.reduce((sum, c) => {
        if (c.rateType === 'percentage') return sum + (subtotal * c.rateValue) / 100
        return sum + c.rateValue
      }, 0)
      const totalAmount = subtotal + totalChargeAmount - sale.discount
      const amountReceived = sale.payments.reduce((s, p) => s + p.amount, 0)
      const profitAmount = sale.items.reduce(
        (sum, item) => sum + (item.unitPrice - item.unitCost) * item.quantity,
        0
      )

      const created = await prisma.$transaction(async (tx) => {
        // Increment invoice counter
        await tx.store.update({
          where: { id: storeId },
          data: { currentSaleNumber: { increment: 1 } },
        })

        const newSale = await tx.sale.create({
          data: {
            syncId: sale.syncId,
            storeId,
            sessionId: sale.sessionId,
            contactId: sale.contactId,
            userId: 1, // will be from auth in full impl
            invoiceNumber,
            saleType: sale.saleType,
            referenceId: sale.referenceId,
            subtotal,
            discount: sale.discount,
            totalChargeAmount,
            totalAmount,
            amountReceived,
            changeAmount: Math.max(0, amountReceived - totalAmount),
            profitAmount,
            status: 'completed',
            paymentStatus: 'fully_paid',
            note: sale.note,
            cartSnapshot: sale.cartSnapshot ?? undefined,
          },
        })

        // Create sale items
        for (const item of sale.items) {
          await tx.saleItem.create({
            data: {
              saleId: newSale.id,
              itemType: 'product',
              productId: item.productId,
              batchId: item.batchId,
              description: item.name,
              quantity: item.quantity,
              freeQuantity: item.freeQuantity,
              unitPrice: item.unitPrice,
              unitCost: item.unitCost,
              discount: item.discount,
              flatDiscount: 0,
              isFree: item.isFree,
              notes: item.notes,
            },
          })

          // Decrement stock
          await tx.productStock.updateMany({
            where: { storeId, productId: item.productId, batchId: item.batchId },
            data: { quantity: { decrement: item.quantity } },
          })
        }

        // Create payment records
        for (const payment of sale.payments) {
          await tx.paymentTransaction.create({
            data: {
              saleId: newSale.id,
              storeId,
              sessionId: sale.sessionId,
              amount: payment.amount,
              paymentMethod: payment.paymentMethod as never,
              transactionType: 'sale',
              chargeState: 'FULLY_CHARGED',
              note: payment.note,
              paymentTerminalRef: payment.paymentTerminalRef,
            },
          })
        }

        // Cash log for cash payments
        const cashPaid = sale.payments
          .filter((p) => p.paymentMethod === 'Cash')
          .reduce((s, p) => s + p.amount, 0)
        if (cashPaid > 0) {
          await tx.cashLog.create({
            data: {
              storeId,
              sessionId: sale.sessionId,
              transactionDate: new Date(),
              transactionType: 'cash_in',
              amount: cashPaid,
              source: 'sale',
              description: `Sale ${invoiceNumber}`,
              referenceId: newSale.id,
            },
          })
        }

        return newSale
      })

      synced.push({
        syncId: sale.syncId,
        serverId: created.id,
        invoiceNumber: created.invoiceNumber,
      })
    } catch (err: unknown) {
      errors.push({
        syncId: sale.syncId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return { synced, errors }
}
