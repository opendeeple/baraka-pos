import { prisma } from '../../config/database'

export async function listExpenses(storeId: number, opts: { dateFrom?: string; dateTo?: string; page?: number }) {
  const { dateFrom, dateTo, page = 1 } = opts
  const limit = 50
  const skip = (page - 1) * limit

  const where = {
    storeId,
    deletedAt: null,
    ...(dateFrom || dateTo ? {
      expenseDate: {
        ...(dateFrom ? { gte: new Date(dateFrom + 'T00:00:00.000Z') } : {}),
        ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59.999Z') } : {}),
      },
    } : {}),
  }

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { expenseDate: 'desc' },
      skip,
      take: limit,
    }),
    prisma.expense.count({ where }),
  ])

  return { expenses, total, page, limit }
}

export async function createExpense(storeId: number, data: {
  description: string
  amount: number
  expenseDate?: string
  source?: string
  sessionId?: number
  isCash?: boolean
}, createdBy: number) {
  if (!data.description?.trim() || !data.amount) throw new Error('description and amount are required')

  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        storeId,
        sessionId: data.sessionId,
        description: data.description,
        amount: data.amount,
        expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
        source: data.source,
        createdBy,
      },
    })

    if (data.isCash) {
      await tx.cashLog.create({
        data: {
          storeId,
          sessionId: data.sessionId,
          transactionType: 'cash_out',
          amount: data.amount,
          source: 'expense',
          description: data.description,
          referenceId: expense.id,
          createdBy,
        },
      })
    }

    return expense
  })
}
