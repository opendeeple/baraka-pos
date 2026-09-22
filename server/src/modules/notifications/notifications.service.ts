import { prisma } from '../../config/database'
import { sendTelegramMessage } from './telegram.service'

export type MessageChannel = 'telegram' | 'sms'
export type MessageTemplate = 'debt' | 'history' | 'custom'

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export async function composeDebtReminderMessage(storeId: number, contactId: number): Promise<string> {
  const [contact, store] = await Promise.all([
    prisma.contact.findFirstOrThrow({ where: { id: contactId, storeId } }),
    prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
  ])
  return [
    `Assalomu alaykum, ${contact.name}!`,
    '',
    `${store.name} do'konidan sizda UZS ${fmt(Number(contact.balance))} miqdorida qarz mavjud.`,
    `Iltimos, imkon qadar tezroq to'lashingizni so'raymiz.`,
    '',
    `Rahmat!`,
  ].join('\n')
}

/** Purchase + debt-payment history, time-ordered, most recent first — the
 *  server composes this from already-synced Sale/SaleItem/CashLog rows, no
 *  round trip to the desktop app's local SQLite needed. */
export async function composeHistoryMessage(storeId: number, contactId: number, limit = 10): Promise<string> {
  const [contact, sales, payments] = await Promise.all([
    prisma.contact.findFirstOrThrow({ where: { id: contactId, storeId } }),
    prisma.sale.findMany({
      where: { contactId, storeId, status: 'completed' },
      include: { items: true },
      orderBy: { saleDate: 'desc' },
      take: limit,
    }),
    prisma.cashLog.findMany({
      where: { contactId, storeId, source: 'deposit' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ])

  const lines = [`${contact.name} — xarid va to'lov tarixi`, '']

  for (const sale of sales) {
    const date = sale.saleDate.toISOString().slice(0, 10)
    lines.push(`${date} — ${sale.invoiceNumber} — UZS ${fmt(Number(sale.totalAmount))}`)
    for (const item of sale.items) {
      lines.push(`  • ${item.description} x${Number(item.quantity)}`)
    }
  }
  if (sales.length === 0) lines.push('Xaridlar topilmadi.')

  if (payments.length > 0) {
    lines.push('', "To'lovlar:")
    for (const p of payments) {
      const date = p.createdAt.toISOString().slice(0, 10)
      lines.push(`${date} — UZS ${fmt(Number(p.amount))}`)
    }
  }

  return lines.join('\n')
}

export async function sendMessage(
  storeId: number,
  contactId: number,
  channel: MessageChannel,
  body: string,
  userId?: number
): Promise<{ success: boolean; error?: string }> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, storeId } })
  if (!contact) return { success: false, error: 'Contact not found' }

  try {
    if (channel === 'telegram') {
      if (!contact.telegramChatId) {
        throw new Error('Customer has not connected Telegram yet — share the connect link first')
      }
      await sendTelegramMessage(contact.telegramChatId, body)
    } else {
      // SMS ships once a gateway/modem is configured (see project plan) —
      // fails clearly instead of silently pretending to send.
      throw new Error('SMS is not configured yet')
    }
    await prisma.messageLog.create({
      data: { storeId, contactId, channel, body, status: 'sent', createdBy: userId },
    })
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Send failed'
    await prisma.messageLog.create({
      data: { storeId, contactId, channel, body, status: 'failed', error, createdBy: userId },
    })
    return { success: false, error }
  }
}

export async function getMessageHistory(storeId: number, contactId: number) {
  return prisma.messageLog.findMany({
    where: { storeId, contactId },
    orderBy: { sentAt: 'desc' },
    take: 50,
  })
}

/** Telegram POSTs every update here. We only care about a /start command
 *  carrying the contact's syncId (from the deep link) — that's how a chat_id
 *  gets attached to a Contact so future sends can reach them. */
export async function handleTelegramStart(contactSyncId: string, chatId: string): Promise<void> {
  await prisma.contact.updateMany({
    where: { syncId: contactSyncId },
    data: { telegramChatId: chatId },
  })
}
