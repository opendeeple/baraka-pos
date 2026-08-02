import { prisma } from '../../config/database'
import { broadcastSaleCompleted, broadcastStockUpdated } from '../../socket'
import { SaleCheckoutRequest } from '@baraka/shared'

export async function checkout(data: SaleCheckoutRequest, userId: number) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: data.storeId } })

  // Idempotency
  const existing = await prisma.sale.findUnique({ where: { syncId: data.syncId } })
  if (existing) return existing

  const isReturn = data.saleType === 'return'

  let originalSale: { invoiceNumber: string } | null = null
  if (isReturn) {
    if (!data.referenceId) throw new Error('referenceId is required for a return')
    originalSale = await prisma.sale.findFirst({
      where: { id: data.referenceId, storeId: data.storeId, status: 'completed' },
      select: { invoiceNumber: true },
    })
    if (!originalSale) throw new Error('Referenced sale not found or not eligible for return')
  }

  const rawSubtotal = data.items.reduce((s, i) => {
    const line = i.unitPrice * i.quantity
    return s + line - line * (i.discount / 100)
  }, 0)

  const rawChargeAmount = data.charges.reduce((s, c) => {
    return s + (c.rateType === 'percentage' ? (rawSubtotal * c.rateValue) / 100 : c.rateValue)
  }, 0)

  const rawProfitAmount = data.items.reduce((s, i) => s + (i.unitPrice - i.unitCost) * i.quantity, 0)

  // A return is stored with negated financial totals so it nets out of
  // existing SUM-based reporting (getDailySummary etc. filter on status only,
  // not saleType) without any change to reports.service.ts.
  const sign = isReturn ? -1 : 1
  const subtotal = sign * rawSubtotal
  const totalChargeAmount = sign * rawChargeAmount
  const totalAmount = subtotal + totalChargeAmount - sign * data.discount
  const amountReceived = sign * data.payments.reduce((s, p) => s + p.amount, 0)
  const profitAmount = sign * rawProfitAmount

  const invoiceNumber = `${store.salePrefix}-${String(store.currentSaleNumber + 1).padStart(6, '0')}`

  const sale = await prisma.$transaction(async (tx) => {
    await tx.store.update({ where: { id: data.storeId }, data: { currentSaleNumber: { increment: 1 } } })

    const newSale = await tx.sale.create({
      data: {
        syncId: data.syncId,
        storeId: data.storeId,
        sessionId: data.sessionId,
        contactId: data.contactId,
        userId,
        invoiceNumber,
        saleType: data.saleType,
        referenceId: data.referenceId,
        subtotal,
        discount: sign * data.discount,
        totalChargeAmount,
        totalAmount,
        amountReceived,
        changeAmount: isReturn ? 0 : Math.max(0, amountReceived - totalAmount),
        profitAmount,
        status: 'completed',
        paymentStatus: 'fully_paid',
        note: data.note,
        cartSnapshot: data.cartSnapshot ?? undefined,
      },
    })

    for (const item of data.items) {
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

      await tx.productStock.updateMany({
        where: { storeId: data.storeId, productId: item.productId, batchId: item.batchId },
        data: { quantity: isReturn ? { increment: item.quantity } : { decrement: item.quantity } },
      })

      // Get updated stock for broadcast
      const updatedStock = await tx.productStock.findFirst({
        where: { storeId: data.storeId, productId: item.productId, batchId: item.batchId },
      })
      if (updatedStock) {
        broadcastStockUpdated(data.storeId, {
          productId: item.productId,
          batchId: item.batchId,
          newQty: Number(updatedStock.quantity),
        })
      }
    }

    for (const payment of data.payments) {
      await tx.paymentTransaction.create({
        data: {
          saleId: newSale.id,
          storeId: data.storeId,
          sessionId: data.sessionId,
          amount: payment.amount,
          paymentMethod: payment.paymentMethod,
          transactionType: isReturn ? 'return' : 'sale',
          chargeState: 'FULLY_CHARGED',
          note: payment.note,
          paymentTerminalRef: payment.paymentTerminalRef,
        },
      })
    }

    const cashAmount = data.payments.filter((p) => p.paymentMethod === 'Cash').reduce((s, p) => s + p.amount, 0)
    if (cashAmount > 0) {
      await tx.cashLog.create({
        data: {
          storeId: data.storeId,
          sessionId: data.sessionId,
          transactionType: isReturn ? 'cash_out' : 'cash_in',
          amount: cashAmount,
          source: 'sale',
          description: isReturn ? `Return for Sale ${originalSale?.invoiceNumber}` : `Sale ${invoiceNumber}`,
          referenceId: newSale.id,
          createdBy: userId,
        },
      })
    }

    const debtAmount = data.payments.filter((p) => p.paymentMethod === 'Debt').reduce((s, p) => s + p.amount, 0)
    if (debtAmount > 0 && data.contactId) {
      await tx.contact.update({
        where: { id: data.contactId },
        // A Debt sale raises what the customer owes; a Debt-refunded return lowers it.
        data: { balance: { increment: isReturn ? -debtAmount : debtAmount } },
      })
    }

    return newSale
  })

  broadcastSaleCompleted(data.storeId, {
    saleId: sale.id,
    invoiceNumber: sale.invoiceNumber,
    terminalId: 'TERMINAL',
    total: Number(totalAmount),
    paymentMethod: data.payments[0]?.paymentMethod ?? 'Cash',
  })

  return sale
}

export async function listSales(storeId: number, opts: {
  dateFrom?: string
  dateTo?: string
  status?: string
  page?: number
}) {
  const { dateFrom, dateTo, status, page = 1 } = opts
  const limit = 50
  const skip = (page - 1) * limit

  const where = {
    storeId,
    deletedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(dateFrom || dateTo ? {
      saleDate: {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      },
    } : {}),
  }

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: { items: true, payments: true, contact: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.sale.count({ where }),
  ])

  return { sales, total, page, limit }
}

export async function getSale(id: number, storeId: number) {
  return prisma.sale.findFirst({
    where: { id, storeId, deletedAt: null },
    include: { items: { include: { product: true } }, payments: true, contact: true, user: true },
  })
}

export async function voidSale(id: number, storeId: number, userId: number) {
  const sale = await prisma.sale.findFirst({ where: { id, storeId } })
  if (!sale) throw new Error('Sale not found')
  if (sale.status === 'cancelled') throw new Error('Sale already voided')

  return prisma.sale.update({
    where: { id },
    data: { status: 'cancelled', deletedAt: new Date() },
  })
}
