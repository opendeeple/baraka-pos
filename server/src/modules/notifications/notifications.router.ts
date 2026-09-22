import { Router, Request, Response } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import { prisma } from '../../config/database'
import { getTelegramDeepLink, isTelegramConfigured } from './telegram.service'
import {
  composeDebtReminderMessage, composeHistoryMessage, sendMessage,
  getMessageHistory, handleTelegramStart, MessageChannel, MessageTemplate,
} from './notifications.service'

const router = Router()

// Telegram calls this directly (no Bearer token) whenever a user interacts
// with the bot — registered separately, before authMiddleware, unlike every
// other route below.
router.post('/telegram/webhook', async (req: Request, res: Response) => {
  try {
    const text: string | undefined = req.body?.message?.text
    const chatId: string | undefined = req.body?.message?.chat?.id?.toString()
    if (text?.startsWith('/start ') && chatId) {
      const contactSyncId = text.slice('/start '.length).trim()
      await handleTelegramStart(contactSyncId, chatId)
    }
    res.json({ ok: true })
  } catch {
    // Telegram retries on non-200 — always ack so a single bad update
    // doesn't get redelivered forever.
    res.json({ ok: true })
  }
})

router.use(authMiddleware)

router.get('/telegram/status', (_req: Request, res: Response) => {
  res.json({ configured: isTelegramConfigured() })
})

router.get('/deep-link/:contactId', async (req: Request, res: Response) => {
  const contactId = Number(req.params.contactId)
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, storeId: req.user!.storeId },
  })
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const link = getTelegramDeepLink(contact.syncId)
  res.json({ link, connected: Boolean(contact.telegramChatId) })
})

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { contactId, template } = req.body as { contactId: number; template: MessageTemplate }
    const body = template === 'debt'
      ? await composeDebtReminderMessage(req.user!.storeId, contactId)
      : await composeHistoryMessage(req.user!.storeId, contactId)
    res.json({ body })
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/send', async (req: Request, res: Response) => {
  try {
    const { contactId, channel, template, customBody } = req.body as {
      contactId: number; channel: MessageChannel; template: MessageTemplate; customBody?: string
    }
    const body = template === 'custom' && customBody
      ? customBody
      : template === 'debt'
        ? await composeDebtReminderMessage(req.user!.storeId, contactId)
        : await composeHistoryMessage(req.user!.storeId, contactId)
    const result = await sendMessage(req.user!.storeId, contactId, channel, body, req.user!.userId)
    res.json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/history/:contactId', async (req: Request, res: Response) => {
  const history = await getMessageHistory(req.user!.storeId, Number(req.params.contactId))
  res.json(history)
})

export default router
