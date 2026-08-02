import { prisma } from '../../config/database'
import { OpenSessionRequest, CloseSessionRequest } from '@baraka/shared'

export async function openSession(data: OpenSessionRequest, userId: number) {
  // Close any stale open sessions for this terminal
  await prisma.posSession.updateMany({
    where: {
      storeId: data.storeId,
      terminalId: data.terminalId,
      state: { in: ['opening_control', 'opened'] },
    },
    data: { state: 'closed', closedAt: new Date() },
  })

  return prisma.posSession.create({
    data: {
      storeId: data.storeId,
      terminalId: data.terminalId,
      userId,
      state: 'opened',
      openingBalance: data.openingBalance,
      openedAt: new Date(),
    },
  })
}

export async function closeSession(data: CloseSessionRequest, userId: number) {
  const session = await prisma.posSession.findUniqueOrThrow({
    where: { id: data.sessionId },
    include: { sales: { include: { payments: true } } },
  })

  // Cash refunds from returns leave the till too — net them against cash sales
  // rather than just excluding them, or a legitimate refund shows as a false
  // "Short" variance at close.
  const cashSales = session.sales
    .flatMap((s) => s.payments)
    .filter((p) => p.paymentMethod === 'Cash' && (p.transactionType === 'sale' || p.transactionType === 'return'))
    .reduce((sum, p) => sum + (p.transactionType === 'return' ? -Number(p.amount) : Number(p.amount)), 0)

  const theoretical = Number(session.openingBalance) + cashSales
  const variance = data.closingBalanceActual - theoretical

  return prisma.posSession.update({
    where: { id: data.sessionId },
    data: {
      state: 'closed',
      closingBalanceTheoretical: theoretical,
      closingBalanceActual: data.closingBalanceActual,
      variance,
      closedAt: new Date(),
    },
  })
}

export async function getCurrentSession(terminalId: string, storeId: number) {
  return prisma.posSession.findFirst({
    where: {
      terminalId,
      storeId,
      state: { in: ['opened', 'opening_control'] },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getSessionSummary(sessionId: number) {
  const session = await prisma.posSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      sales: {
        where: { status: 'completed' },
        include: { payments: true },
      },
    },
  })

  // Net returns (transactionType:'return') against sales rather than summing
  // them as-is, or a refund inflates these totals instead of reducing them.
  const netAmount = (p: { amount: unknown; transactionType: string }) =>
    p.transactionType === 'return' ? -Number(p.amount) : Number(p.amount)
  const payments = session.sales
    .flatMap((s) => s.payments)
    .filter((p) => p.transactionType === 'sale' || p.transactionType === 'return')
  const totalCash = payments.filter((p) => p.paymentMethod === 'Cash').reduce((s, p) => s + netAmount(p), 0)
  const totalCard = payments.filter((p) => p.paymentMethod === 'Card').reduce((s, p) => s + netAmount(p), 0)
  const totalOther = payments
    .filter((p) => !['Cash', 'Card'].includes(p.paymentMethod))
    .reduce((s, p) => s + netAmount(p), 0)
  const totalSales = totalCash + totalCard + totalOther
  const theoreticalCash = Number(session.openingBalance) + totalCash

  return {
    session,
    totalSales,
    totalCash,
    totalCard,
    totalOther,
    saleCount: session.sales.length,
    theoreticalCash,
    variance: Number(session.closingBalanceActual ?? 0) - theoreticalCash,
  }
}
