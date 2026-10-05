import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Save, Printer, TestTube2, RefreshCw, Globe, Maximize, Minimize, Send, BellRing, Banknote, Scale, Store, Receipt, Monitor,
  type LucideIcon,
} from 'lucide-react'
import { DEFAULT_SCALE_CONFIG, SCALE_SETTING_KEY, parseScaleBarcode, readScaleConfig, type ScaleConfig } from '../../lib/scaleBarcode'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { toast } from 'sonner'
import { Select } from '../../components/ui/Select'
import { PinConfirmModal } from '../../components/ui/PinConfirmModal'
import { LANGUAGES, setAppLanguage, type AppLanguage } from '../../i18n'
import { SYNC_TABLES, pullSyncTable } from '../../hooks/useSync'
import { SHARED_SETTING_KEYS } from '@baraka/shared'
import { v4 as uuidv4 } from 'uuid'
import { logAudit } from '../../lib/audit'
import { DevicesPanel } from '../../components/backoffice/DevicesPanel'

interface StoreSetting { meta_key: string; meta_value: string }

interface PrinterConfig {
  type: 'usb' | 'network' | 'windows'
  vendorId: string; productId: string
  host: string; port: string
  name: string
}

interface TelegramConfig {
  botToken: string
  botUsername: string
}

interface SmsConfig {
  host: string
  token: string
}

interface AutoReminderConfig {
  enabled: boolean
  intervalDays: number
}

interface DebtSaleNotifyConfig {
  enabled: boolean
}

interface ReceiptSettings {
  header: string; footer: string; show_logo: boolean
  show_cashier: boolean; copies: number
}

type ReceiptElementKey =
  | 'storeName' | 'storeInfo' | 'invoiceInfo' | 'items' | 'itemQty' | 'table'
  | 'totals' | 'totalRow' | 'footer' | 'saleNumber'

interface ElementStyle { fontPx: number; shiftPx: number }

interface ReceiptLayout {
  paperWidthMm: number
  marginMm: number
  charWidth: number
  elements: Record<ReceiptElementKey, ElementStyle>
}

const ELEMENT_LABELS: Array<[ReceiptElementKey, string]> = [
  ['storeName', 'Store Name'],
  ['storeInfo', 'Address / Phone / Header'],
  ['invoiceInfo', 'Chek № / Sana / Mijoz / Kassir'],
  ['table', 'Jadval (№ / Tovar / Soni / Narx / Summa)'],
  ['totals', 'Charges / Payment / Change'],
  ['totalRow', "TO'LOV (chegirma bo'lsa)"],
  ['footer', 'Footer (Thank You)'],
  ['saleNumber', 'Sale Number (bottom)'],
]

// Matches printer.ipc.ts's DEFAULT_RECEIPT_LAYOUT — the values already
// hand-tuned against the real till printer (Xprinter XP-365B, 76mm/75mm
// roll) in an earlier session.
const DEFAULT_LAYOUT: ReceiptLayout = {
  paperWidthMm: 75,
  marginMm: 5,
  charWidth: 34,
  elements: {
    storeName: { fontPx: 22, shiftPx: 10 },
    storeInfo: { fontPx: 11, shiftPx: 25 },
    invoiceInfo: { fontPx: 11, shiftPx: -1 },
    items: { fontPx: 11, shiftPx: 0 },
    itemQty: { fontPx: 10, shiftPx: 0 },
    table: { fontPx: 9, shiftPx: 0 },
    totals: { fontPx: 11, shiftPx: 0 },
    totalRow: { fontPx: 11, shiftPx: 0 },
    footer: { fontPx: 13, shiftPx: 0 },
    saleNumber: { fontPx: 13, shiftPx: 0 },
  },
}

interface ChargeRow { id: number; name: string; rate_type: string; rate_value: number; is_active: number }

type SettingsTab = 'store' | 'receipt' | 'messages' | 'scale' | 'screen'

const SETTINGS_TABS: Array<[SettingsTab, LucideIcon]> = [
  ['store', Store], ['receipt', Receipt], ['messages', Send], ['scale', Scale], ['screen', Monitor],
]

const splitPrefixes = (s: string) => s.split(/[\s,;]+/).map((p) => p.trim()).filter((p) => /^\d{1,3}$/.test(p))

const SECTION_CLS = 'bg-dark-surface border border-dark-border rounded-2xl p-5 space-y-4'
const LABEL_CLS = 'text-xs text-gray-400 mb-1 block'
const INPUT_CLS = 'w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary'

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [printer, setPrinter] = useState<PrinterConfig>({
    type: 'usb', vendorId: '0x0416', productId: '0x5011', host: '192.168.1.100', port: '9100', name: '',
  })
  const [receipt, setReceipt] = useState<ReceiptSettings>({
    header: '', footer: 'XARIDINGIZ UCHUN RAHMAT', show_logo: false, show_cashier: true, copies: 1,
  })
  const [layout, setLayout] = useState<ReceiptLayout>(DEFAULT_LAYOUT)
  const [telegram, setTelegram] = useState<TelegramConfig>({ botToken: '', botUsername: '' })
  const [sms, setSms] = useState<SmsConfig>({ host: '', token: '' })
  const [autoReminder, setAutoReminder] = useState<AutoReminderConfig>({ enabled: false, intervalDays: 3 })
  const [runningReminders, setRunningReminders] = useState(false)
  // Default on — matches debtNotify.service.ts's DEFAULT_CONFIG.
  const [debtSaleNotify, setDebtSaleNotify] = useState<DebtSaleNotifyConfig>({ enabled: true })
  const [charges, setCharges] = useState<ChargeRow[]>([])
  const [storeName, setStoreName] = useState('')
  const [storeAddress, setStoreAddress] = useState('')
  const [storePhone, setStorePhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [changingLang, setChangingLang] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [togglingFullscreen, setTogglingFullscreen] = useState(false)
  const [ownerPin, setOwnerPin] = useState('')
  const [openingDrawer, setOpeningDrawer] = useState(false)
  const [pendingDrawerConfirm, setPendingDrawerConfirm] = useState(false)
  const [tab, setTab] = useState<SettingsTab>('store')
  const [scale, setScale] = useState<ScaleConfig>(DEFAULT_SCALE_CONFIG)
  const [scalePrefixes, setScalePrefixes] = useState(DEFAULT_SCALE_CONFIG.prefixes.join(', '))
  const [scaleTest, setScaleTest] = useState('')
  const { t, i18n } = useTranslation()

  useEffect(() => { loadSettings() }, [])
  useEffect(() => {
    window.electronAPI.window.isFullscreen().then((r) => setFullscreen(r.fullscreen))
  }, [])

  async function changeLanguage(lang: AppLanguage) {
    if (lang === i18n.language) return
    setChangingLang(true)
    try { await setAppLanguage(lang) } finally { setChangingLang(false) }
  }

  async function toggleFullscreen() {
    setTogglingFullscreen(true)
    try {
      const r = await window.electronAPI.window.toggleFullscreen()
      setFullscreen(r.fullscreen)
    } finally {
      setTogglingFullscreen(false)
    }
  }

  async function loadSettings() {
    const rows = await window.electronAPI.db.query(`SELECT meta_key, meta_value FROM settings`, []) as StoreSetting[]
    const map: Record<string, string> = {}
    rows.forEach((r) => { map[r.meta_key] = r.meta_value })
    setSettings(map)

    if (map.printer_config) {
      try { setPrinter(JSON.parse(map.printer_config)) } catch {}
    }
    if (map.receipt_template) {
      try { setReceipt(JSON.parse(map.receipt_template)) } catch {}
    }
    if (map.receipt_layout) {
      try {
        const saved = JSON.parse(map.receipt_layout) as Partial<ReceiptLayout>
        setLayout({
          ...DEFAULT_LAYOUT,
          ...saved,
          elements: { ...DEFAULT_LAYOUT.elements, ...saved.elements },
        })
      } catch {}
    }
    if (map.owner_expense_pin) setOwnerPin(map.owner_expense_pin)
    if (map.telegram_config) {
      try { setTelegram({ botToken: '', botUsername: '', ...JSON.parse(map.telegram_config) }) } catch {}
    }
    if (map.sms_config) {
      try { setSms({ host: '', token: '', ...JSON.parse(map.sms_config) }) } catch {}
    }
    if (map.auto_reminder_config) {
      try { setAutoReminder({ enabled: false, intervalDays: 3, ...JSON.parse(map.auto_reminder_config) }) } catch {}
    }
    if (map.debt_sale_notify_config) {
      try { setDebtSaleNotify({ enabled: true, ...JSON.parse(map.debt_sale_notify_config) }) } catch {}
    }
    const scaleCfg = readScaleConfig(map[SCALE_SETTING_KEY])
    setScale(scaleCfg)
    setScalePrefixes(scaleCfg.prefixes.join(', '))

    const storeRow = await window.electronAPI.db.query(`SELECT name, address, phone FROM stores LIMIT 1`, []) as Array<{name:string;address:string;phone:string}>
    if (storeRow[0]) {
      setStoreName(storeRow[0].name ?? '')
      setStoreAddress(storeRow[0].address ?? '')
      setStorePhone(storeRow[0].phone ?? '')
    }

    setCharges(await window.electronAPI.db.query(
      `SELECT id, name, rate_type, rate_value, is_active FROM charges ORDER BY name`, []
    ) as ChargeRow[])
  }

  // Store-wide keys (SHARED_SETTING_KEYS) sync to every device; the rest
  // (printer, paper layout) belong to this till only. Unchanged values aren't
  // re-sent, so Save doesn't flood the outbox or the journal.
  async function saveSetting(key: string, value: string) {
    const now = new Date().toISOString()
    const [existing] = await window.electronAPI.db.query(`SELECT id, meta_value, sync_id FROM settings WHERE meta_key=?`, [key]) as Array<{ id: number; meta_value: string; sync_id: string | null }>
    if (existing && existing.meta_value === value) return
    const syncId = existing?.sync_id ?? uuidv4()
    if (existing) {
      await window.electronAPI.db.exec(`UPDATE settings SET meta_value=?, updated_at=?, sync_id=? WHERE meta_key=?`, [value, now, syncId, key])
    } else {
      await window.electronAPI.db.exec(`INSERT INTO settings (meta_key,meta_value,created_at,updated_at,sync_id) VALUES (?,?,?,?,?)`, [key, value, now, now, syncId])
    }
    if (SHARED_SETTING_KEYS.includes(key)) {
      await window.electronAPI.sync.enqueue('settings', syncId, 'upsert')
      // Secrets (tokens, PIN) are never written into the journal.
      await logAudit('settings_change', { entity: 'setting', entityId: key })
    }
  }

  async function saveAll() {
    setSaving(true)
    const now = new Date().toISOString()
    try {
      await saveSetting('printer_config', JSON.stringify(printer))
      await saveSetting('receipt_template', JSON.stringify(receipt))
      await saveSetting('receipt_layout', JSON.stringify(layout))
      await saveSetting('owner_expense_pin', ownerPin)
      await saveSetting('telegram_config', JSON.stringify(telegram))
      await saveSetting('sms_config', JSON.stringify(sms))
      await saveSetting('auto_reminder_config', JSON.stringify(autoReminder))
      await saveSetting('debt_sale_notify_config', JSON.stringify(debtSaleNotify))
      const prefixes = splitPrefixes(scalePrefixes)
      await saveSetting(SCALE_SETTING_KEY, JSON.stringify({ ...scale, prefixes: prefixes.length ? prefixes : DEFAULT_SCALE_CONFIG.prefixes }))
      // The store's name/address/phone print on every till's receipts.
      const [st] = await window.electronAPI.db.query(`SELECT id, name, address, phone, sync_id FROM stores ORDER BY id LIMIT 1`, []) as Array<{ id: number; name: string; address: string | null; phone: string | null; sync_id: string | null }>
      if (st && (st.name !== storeName || (st.address ?? '') !== storeAddress || (st.phone ?? '') !== storePhone)) {
        const syncId = st.sync_id ?? uuidv4()
        await window.electronAPI.db.exec(`UPDATE stores SET name=?,address=?,phone=?,updated_at=?,sync_id=? WHERE id=?`, [storeName, storeAddress, storePhone, now, syncId, st.id])
        await window.electronAPI.sync.enqueue('stores', syncId, 'upsert')
      }
      window.electronAPI.sync.pushPending().catch(() => {})
      toast.success(t('settings.saved'))
    } finally { setSaving(false) }
  }

  async function runRemindersNow() {
    setRunningReminders(true)
    try {
      await saveSetting('auto_reminder_config', JSON.stringify(autoReminder))
      const r = await window.electronAPI.telegram.runAutoReminders()
      toast.success(t('settings.autoReminderRunResult', { sent: r.sent, skipped: r.skipped, failed: r.failed }))
    } catch (e) {
      toast.error(String(e))
    } finally {
      setRunningReminders(false)
    }
  }

  async function testPrint() {
    setTesting(true)
    try { await window.electronAPI.printer.testPrint() } catch (e) { toast.error(String(e)) }
    finally { setTesting(false) }
  }

  /** Manual drawer-open — gated behind the owner PIN (same one that gates
   *  Owner-category expenses) since opening the drawer with no sale attached
   *  is exactly the kind of thing that shouldn't need only a cashier login.
   *  Same convention as ExpensesScreen: no PIN set means no gate. */
  function openDrawerClick() {
    if (ownerPin) { setPendingDrawerConfirm(true); return }
    openDrawer()
  }

  async function openDrawer() {
    setOpeningDrawer(true)
    try {
      const r = await window.electronAPI.printer.openCashDrawer()
      if (r.success) {
        toast.success(t('settings.drawerOpened'))
        await logAudit('drawer_open', { entity: 'drawer' })
      } else toast.error(r.error || t('settings.drawerFailed'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setOpeningDrawer(false)
    }
  }

  async function syncNow() {
    setSyncing(true)
    try {
      // One at a time, in SYNC_TABLES order: sales, repayments and debt
      // clearances resolve their contact while being written, so contacts
      // must land first.
      let failed = 0
      for (const table of SYNC_TABLES) {
        try { await pullSyncTable(table) } catch { failed++ }
      }
      if (failed === 0) toast.success(t('settings.syncDone'))
      else if (failed < SYNC_TABLES.length) toast.warning(t('settings.syncPartial', { ok: SYNC_TABLES.length - failed, total: SYNC_TABLES.length }))
      else toast.error(t('settings.syncFailed'))
      await loadSettings()
    } finally { setSyncing(false) }
  }

  // Switching a service charge on/off applies on every till, not just this one.
  async function toggleCharge(id: number, active: number) {
    await window.electronAPI.db.exec(`UPDATE charges SET is_active=?,updated_at=? WHERE id=?`, [active ? 0 : 1, new Date().toISOString(), id])
    const [row] = await window.electronAPI.db.query(`SELECT sync_id FROM charges WHERE id=?`, [id]) as Array<{ sync_id: string | null }>
    if (row?.sync_id) {
      await window.electronAPI.sync.enqueue('charges', row.sync_id, 'upsert')
      window.electronAPI.sync.pushPending().catch(() => {})
    }
    loadSettings()
  }

  const p = (k: keyof PrinterConfig, v: string) => setPrinter((prev) => ({ ...prev, [k]: v }))
  const r = (k: keyof ReceiptSettings, v: string | boolean | number) => setReceipt((prev) => ({ ...prev, [k]: v }))
  const l = (k: 'paperWidthMm' | 'marginMm' | 'charWidth', v: number) =>
    setLayout((prev) => ({ ...prev, [k]: v }))
  const le = (key: ReceiptElementKey, field: keyof ElementStyle, v: number) =>
    setLayout((prev) => ({
      ...prev,
      elements: { ...prev.elements, [key]: { ...prev.elements[key], [field]: v } },
    }))

  return (
    <BackOfficeLayout>
      <div className="shrink-0 px-6 py-4 border-b border-dark-border bg-dark-surface flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">{t('nav.settings')}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{t('pageHints.settings')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncNow} disabled={syncing}
            className="flex items-center gap-2 border border-dark-border text-gray-300 hover:text-white px-4 py-2 rounded-xl text-sm transition-colors">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {t('settings.syncNow')}
          </button>
          <button onClick={saveAll} disabled={saving}
            className="flex items-center gap-2 bg-primary hover:bg-orange-600 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            <Save size={14} /> {saving ? t('common.saving') : t('settings.saveChanges')}
          </button>
        </div>
      </div>

      <div className="shrink-0 px-6 pt-3 border-b border-dark-border bg-dark-surface flex gap-1">
        {SETTINGS_TABS.map(([key, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 h-11 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-white'
            }`}>
            <Icon size={15} /> {t(`settings.tab_${key}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {tab === 'screen' && (<>
        {/* Language */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm flex items-center gap-2"><Globe size={15} /> {t('settings.language')}</h2>
          <div className="flex gap-2">
            {LANGUAGES.map((lng) => (
              <button
                key={lng.code}
                onClick={() => changeLanguage(lng.code)}
                disabled={changingLang}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                  i18n.language === lng.code
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'border-dark-border text-gray-300 hover:text-white hover:bg-dark-card'
                }`}
              >
                {lng.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fullscreen */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            {fullscreen ? <Minimize size={15} /> : <Maximize size={15} />} {t('posSettings.fullscreen')}
          </h2>
          <button
            onClick={toggleFullscreen}
            disabled={togglingFullscreen}
            className="w-full flex items-center justify-center gap-2 border border-dark-border text-gray-300 hover:text-white hover:bg-dark-card px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {fullscreen
              ? <><Minimize size={14} /> {t('posSettings.exitFullscreen')}</>
              : <><Maximize size={14} /> {t('posSettings.enterFullscreen')}</>}
          </button>
        </div>
        </>)}

        {tab === 'store' && (<>
        {/* Store Info */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm">{t('settings.storeInformation')}</h2>
          <div className="grid grid-cols-3 gap-3">
            {[[t('settings.storeName'), storeName, setStoreName], [t('common.address'), storeAddress, setStoreAddress], [t('common.phone'), storePhone, setStorePhone]].map(([label, val, set]) => (
              <div key={label as string}>
                <label className={LABEL_CLS}>{label as string}</label>
                <input value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} className={INPUT_CLS} />
              </div>
            ))}
          </div>
        </div>

        <DevicesPanel className={SECTION_CLS} />

        {/* Owner personal-expense PIN */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm">{t('settings.ownerExpensePin')}</h2>
          <p className="text-xs text-gray-500">{t('settings.ownerExpensePinHint')}</p>
          <div className="max-w-xs">
            <label className={LABEL_CLS}>{t('settings.pinCode')}</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={ownerPin}
              onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className={INPUT_CLS}
            />
          </div>
        </div>

        {/* Taxes & Charges */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm">{t('settings.chargesTitle')}</h2>
          <p className="text-xs text-gray-500 -mt-2">{t('settings.chargesHint')}</p>
          {charges.length === 0 ? (
            <p className="text-gray-600 text-sm">{t('settings.noCharges')}</p>
          ) : (
            <div className="space-y-2">
              {charges.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-dark-border/50 last:border-0">
                  <div>
                    <p className="text-white text-sm">{c.name}</p>
                    <p className="text-gray-500 text-xs">
                      {c.rate_type === 'percentage' ? `${Number(c.rate_value)}%` : `UZS ${fmtUZS(Number(c.rate_value))}`}
                    </p>
                  </div>
                  <button onClick={() => toggleCharge(c.id, c.is_active)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${c.is_active ? 'bg-primary' : 'bg-dark-border'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${c.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        </>)}

        {tab === 'messages' && (<>
        {/* Telegram messaging — runs client-side (this app polls Telegram
            directly, no server involved yet); see notifications.* keys. */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm flex items-center gap-2"><Send size={15} /> {t('settings.telegramBot')}</h2>
          <p className="text-xs text-gray-500">{t('settings.telegramBotHint')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>{t('settings.telegramBotToken')}</label>
              <input
                type="password"
                value={telegram.botToken}
                onChange={(e) => setTelegram((p) => ({ ...p, botToken: e.target.value }))}
                placeholder="123456789:AAE..."
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>{t('settings.telegramBotUsername')}</label>
              <input
                value={telegram.botUsername}
                onChange={(e) => setTelegram((p) => ({ ...p, botUsername: e.target.value.replace(/^@/, '') }))}
                placeholder="baraka_mini_market_bot"
                className={INPUT_CLS}
              />
            </div>
          </div>
        </div>

        {/* SMS via a dedicated Android phone running "Traccar SMS Gateway"
            (Local Service) — the phone exposes a token-authenticated HTTP
            endpoint over the same Wi-Fi network; see sms.service.ts. */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm flex items-center gap-2"><Send size={15} /> {t('settings.smsGateway')}</h2>
          <p className="text-xs text-gray-500">{t('settings.smsGatewayHint')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>{t('settings.smsGatewayHost')}</label>
              <input
                value={sms.host}
                onChange={(e) => setSms((p) => ({ ...p, host: e.target.value }))}
                placeholder="192.168.1.50:8082"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>{t('settings.smsGatewayToken')}</label>
              <input
                type="password"
                value={sms.token}
                onChange={(e) => setSms((p) => ({ ...p, token: e.target.value }))}
                className={INPUT_CLS}
              />
            </div>
          </div>
        </div>

        {/* Automatic debt reminders — a scheduler in the Electron main
            process (autoReminder.service.ts) checks hourly and messages any
            Telegram-connected debtor whose last reminder is older than the
            interval below; a contact stops being selected the moment their
            balance reaches 0, so a paid-off debt is never reminded again. */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm flex items-center gap-2"><BellRing size={15} /> {t('settings.autoReminder')}</h2>
          <p className="text-xs text-gray-500">{t('settings.autoReminderHint')}</p>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={autoReminder.enabled}
              onChange={(e) => setAutoReminder((p) => ({ ...p, enabled: e.target.checked }))}
              className="w-4 h-4"
            />
            {t('settings.autoReminderEnabled')}
          </label>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className={LABEL_CLS}>{t('settings.autoReminderInterval')}</label>
              <input
                type="number" min={1} step={1}
                value={autoReminder.intervalDays}
                onChange={(e) => setAutoReminder((p) => ({ ...p, intervalDays: Number(e.target.value) || 1 }))}
                className={INPUT_CLS}
              />
            </div>
            <button onClick={runRemindersNow} disabled={runningReminders}
              className="flex items-center justify-center gap-2 border border-dark-border text-gray-300 hover:text-white px-3 py-2 rounded-lg text-xs transition-colors h-[38px]">
              <BellRing size={13} /> {runningReminders ? t('common.loading') : t('settings.autoReminderRunNow')}
            </button>
          </div>
        </div>

        {/* Instant debt-sale message — sent by debtNotify.service.ts right
            after a POS sale with a Debt payment (Telegram, else SMS). */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm flex items-center gap-2"><Send size={15} /> {t('settings.debtSaleNotify')}</h2>
          <p className="text-xs text-gray-500">{t('settings.debtSaleNotifyHint')}</p>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={debtSaleNotify.enabled}
              onChange={(e) => setDebtSaleNotify({ enabled: e.target.checked })}
              className="w-4 h-4"
            />
            {t('settings.debtSaleNotifyEnabled')}
          </label>
        </div>
        </>)}

        {tab === 'scale' && (
          <div className={SECTION_CLS}>
            <h2 className="text-white font-semibold text-sm flex items-center gap-2"><Scale size={15} /> {t('settings.scaleTitle')}</h2>
            <p className="text-xs text-gray-500 -mt-2">{t('settings.scaleHint')}</p>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" className="w-4 h-4" checked={scale.enabled}
                onChange={(e) => setScale((s) => ({ ...s, enabled: e.target.checked }))} />
              {t('settings.scaleEnabled')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={LABEL_CLS}>{t('settings.scalePrefixes')}</label>
                <input value={scalePrefixes} onChange={(e) => setScalePrefixes(e.target.value)} placeholder="20, 21, 22" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>{t('settings.scalePluLength')}</label>
                <Select value={String(scale.pluLength)} onChange={(v) => setScale((s) => ({ ...s, pluLength: Number(v) }))}
                  options={[4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} />
              </div>
              <div>
                <label className={LABEL_CLS}>{t('settings.scaleWeightUnit')}</label>
                <Select value={String(scale.weightDecimals)} onChange={(v) => setScale((s) => ({ ...s, weightDecimals: Number(v) }))}
                  options={[{ value: '3', label: t('settings.scaleGrams') }, { value: '2', label: t('settings.scaleTensOfGrams') }]} />
              </div>
            </div>
            <div className="bg-dark-card rounded-xl p-3 space-y-2">
              <label className={LABEL_CLS}>{t('settings.scaleTest')}</label>
              <input value={scaleTest} onChange={(e) => setScaleTest(e.target.value.trim())} placeholder="2200123012504" className={INPUT_CLS} />
              {scaleTest && (() => {
                const parsed = parseScaleBarcode(scaleTest, { ...scale, enabled: true, prefixes: splitPrefixes(scalePrefixes) })
                return (
                  <p className={`text-sm ${parsed ? 'text-green-400' : 'text-red-400'}`}>
                    {parsed ? t('settings.scaleDecoded', { plu: parsed.plu, kg: parsed.weightKg }) : t('settings.scaleNotDecoded')}
                  </p>
                )
              })()}
            </div>
            <p className="text-xs text-gray-500">{t('settings.scalePluHint')}</p>
          </div>
        )}

        {tab === 'receipt' && (<>
        {/* Printer */}
        <div className={SECTION_CLS}>
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold text-sm">{t('settings.printerTitle')}</h2>
            <div className="flex items-center gap-2">
              <button onClick={openDrawerClick} disabled={openingDrawer}
                className="flex items-center gap-2 border border-dark-border text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-xs transition-colors">
                <Banknote size={13} /> {openingDrawer ? '…' : t('settings.openDrawer')}
              </button>
              <button onClick={testPrint} disabled={testing}
                className="flex items-center gap-2 border border-dark-border text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-xs transition-colors">
                <TestTube2 size={13} /> {testing ? '…' : t('settings.testPrint')}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">{t('settings.openDrawerHint')}</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL_CLS}>{t('settings.printerConnection')}</label>
              <Select
                value={printer.type}
                onChange={(v) => p('type', v as PrinterConfig['type'])}
                options={[
                  { value: 'windows', label: t('settings.printerWindows') },
                  { value: 'usb', label: 'USB' },
                  { value: 'network', label: t('settings.printerNetwork') },
                ]}
              />
            </div>
            {printer.type === 'usb' && (
              <>
                <div>
                  <label className={LABEL_CLS}>Vendor ID</label>
                  <input value={printer.vendorId} onChange={(e) => p('vendorId', e.target.value)} placeholder="0x0416" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Product ID</label>
                  <input value={printer.productId} onChange={(e) => p('productId', e.target.value)} placeholder="0x5011" className={INPUT_CLS} />
                </div>
              </>
            )}
            {printer.type === 'network' && (
              <>
                <div>
                  <label className={LABEL_CLS}>{t('settings.printerIp')}</label>
                  <input value={printer.host} onChange={(e) => p('host', e.target.value)} placeholder="192.168.1.100" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Port</label>
                  <input value={printer.port} onChange={(e) => p('port', e.target.value)} placeholder="9100" className={INPUT_CLS} />
                </div>
              </>
            )}
            {printer.type === 'windows' && (
              <div className="col-span-2">
                <label className={LABEL_CLS}>{t('settings.printerName')}</label>
                <input value={printer.name} onChange={(e) => p('name', e.target.value)} placeholder="POS-58 Printer" className={INPUT_CLS} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Printer size={14} className="text-gray-500" />
            <span className="text-xs text-gray-500">{t('settings.printerAppliesNow')}</span>
          </div>
        </div>

        {/* Receipt Print Layout — only affects the "Windows Printer" path (printer.type === 'windows');
            direct USB/network ESC/POS printing has its own fixed layout. */}
        {printer.type === 'windows' && (
          <div className={SECTION_CLS}>
            <h2 className="text-white font-semibold text-sm">{t('settings.layoutTitle')}</h2>
            <p className="text-xs text-gray-500 -mt-2">{t('settings.layoutHint')}</p>

            <div className="grid grid-cols-3 gap-3">
              {([
                [t('settings.paperWidth'), 'paperWidthMm', 1],
                [t('settings.sideMargin'), 'marginMm', 0.5],
                [t('settings.charsPerLine'), 'charWidth', 1],
              ] as Array<[string, 'paperWidthMm' | 'marginMm' | 'charWidth', number]>).map(([label, key, step]) => (
                <div key={key}>
                  <label className={LABEL_CLS}>{label}</label>
                  <input type="number" step={step} min={0} value={layout[key]}
                    onChange={(e) => l(key, Number(e.target.value) || 0)} className={INPUT_CLS} />
                </div>
              ))}
            </div>

            <div>
              <label className={LABEL_CLS}>{t('settings.textSizePosition')}</label>
              <p className="text-xs text-gray-600 mb-2">{t('settings.textSizePositionHint')}</p>
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr,88px,96px] gap-2 px-1">
                  <span className="text-xs text-gray-500">{t('settings.textCol')}</span>
                  <span className="text-xs text-gray-500">{t('settings.sizeCol')}</span>
                  <span className="text-xs text-gray-500">{t('settings.positionCol')}</span>
                </div>
                {ELEMENT_LABELS.map(([key, label]) => (
                  <div key={key} className="grid grid-cols-[1fr,88px,96px] gap-2 items-center bg-dark-card rounded-lg px-3 py-2">
                    <span className="text-sm text-gray-300">{t(`settings.el_${key}`, { defaultValue: label })}</span>
                    <input type="number" min={6} value={layout.elements[key].fontPx}
                      onChange={(e) => le(key, 'fontPx', Number(e.target.value) || 0)}
                      className="w-full bg-dark border border-dark-border rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-primary" />
                    <input type="number" value={layout.elements[key].shiftPx}
                      onChange={(e) => le(key, 'shiftPx', Number(e.target.value) || 0)}
                      className="w-full bg-dark border border-dark-border rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-primary" />
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => setLayout(DEFAULT_LAYOUT)}
              className="text-xs text-gray-500 hover:text-primary transition-colors">
              {t('settings.resetDefaults')}
            </button>
          </div>
        )}

        {/* Receipt */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm">{t('settings.receiptTitle')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>{t('settings.receiptHeader')}</label>
              <textarea value={receipt.header} onChange={(e) => r('header', e.target.value)} rows={2}
                placeholder={t('settings.receiptHeaderPlaceholder')}
                className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary resize-none" />
            </div>
            <div>
              <label className={LABEL_CLS}>{t('settings.receiptFooter')}</label>
              <textarea value={receipt.footer} onChange={(e) => r('footer', e.target.value)} rows={2}
                className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary resize-none" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {[
              { key: 'show_cashier', label: t('settings.showCashier') },
              { key: 'show_logo', label: t('settings.showLogo') },
            ].map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
                <button onClick={() => r(opt.key as keyof ReceiptSettings, !receipt[opt.key as keyof ReceiptSettings])}
                  className={`w-9 h-5 rounded-full transition-colors relative ${receipt[opt.key as keyof ReceiptSettings] ? 'bg-primary' : 'bg-dark-border'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${receipt[opt.key as keyof ReceiptSettings] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm text-gray-400">{opt.label}</span>
              </label>
            ))}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">{t('settings.copies')}</label>
              <input type="number" min={1} max={3} value={receipt.copies} onChange={(e) => r('copies', Number(e.target.value))}
                className="w-16 bg-dark-card border border-dark-border rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-primary" />
            </div>
          </div>
        </div>
        </>)}
      </div>

      {pendingDrawerConfirm && (
        <PinConfirmModal
          expectedPin={ownerPin}
          title={t('settings.openDrawer')}
          onClose={() => setPendingDrawerConfirm(false)}
          onConfirmed={() => { setPendingDrawerConfirm(false); openDrawer() }}
        />
      )}
    </BackOfficeLayout>
  )
}
