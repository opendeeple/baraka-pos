import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, Printer, TestTube2, RefreshCw, Globe, Maximize, Minimize } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { fmtUZS } from '../../lib/currency'
import { toast } from 'sonner'
import { Select } from '../../components/ui/Select'
import { LANGUAGES, setAppLanguage, type AppLanguage } from '../../i18n'

interface StoreSetting { meta_key: string; meta_value: string }

interface PrinterConfig {
  type: 'usb' | 'network' | 'windows'
  vendorId: string; productId: string
  host: string; port: string
  name: string
}

interface ReceiptSettings {
  header: string; footer: string; show_logo: boolean
  show_barcode: boolean; show_cashier: boolean; copies: number
}

type ReceiptElementKey =
  | 'storeName' | 'storeInfo' | 'invoiceInfo' | 'items' | 'itemQty'
  | 'totals' | 'totalRow' | 'footer' | 'barcode'

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
  ['invoiceInfo', 'Invoice / Cashier / Date'],
  ['items', 'Item Name + Price'],
  ['itemQty', 'Item Qty × Unit Price'],
  ['totals', 'Charges / Payment / Change'],
  ['totalRow', 'TOTAL AMOUNT'],
  ['footer', 'Footer (Thank You)'],
  ['barcode', 'Barcode Line'],
]

const DEFAULT_LAYOUT: ReceiptLayout = {
  paperWidthMm: 60,
  marginMm: 3,
  charWidth: 28,
  elements: {
    storeName: { fontPx: 13, shiftPx: 0 },
    storeInfo: { fontPx: 11, shiftPx: 0 },
    invoiceInfo: { fontPx: 11, shiftPx: 0 },
    items: { fontPx: 11, shiftPx: 0 },
    itemQty: { fontPx: 10, shiftPx: 0 },
    totals: { fontPx: 11, shiftPx: 0 },
    totalRow: { fontPx: 11, shiftPx: 0 },
    footer: { fontPx: 13, shiftPx: 0 },
    barcode: { fontPx: 11, shiftPx: 0 },
  },
}

interface ChargeRow { id: number; name: string; rate_type: string; rate_value: number; is_active: number }

const SECTION_CLS = 'bg-dark-surface border border-dark-border rounded-2xl p-5 space-y-4'
const LABEL_CLS = 'text-xs text-gray-400 mb-1 block'
const INPUT_CLS = 'w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary'

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [printer, setPrinter] = useState<PrinterConfig>({
    type: 'usb', vendorId: '0x0416', productId: '0x5011', host: '192.168.1.100', port: '9100', name: '',
  })
  const [receipt, setReceipt] = useState<ReceiptSettings>({
    header: '', footer: 'Thank you for shopping with us!', show_logo: false, show_barcode: true, show_cashier: true, copies: 1,
  })
  const [layout, setLayout] = useState<ReceiptLayout>(DEFAULT_LAYOUT)
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

  async function saveSetting(key: string, value: string) {
    const now = new Date().toISOString()
    const existing = await window.electronAPI.db.query(`SELECT id FROM settings WHERE meta_key=?`, [key]) as Array<{id:number}>
    if (existing.length) {
      await window.electronAPI.db.exec(`UPDATE settings SET meta_value=?,updated_at=? WHERE meta_key=?`, [value, now, key])
    } else {
      await window.electronAPI.db.exec(`INSERT INTO settings (meta_key,meta_value,created_at,updated_at) VALUES (?,?,?,?)`, [key, value, now, now])
    }
  }

  async function saveAll() {
    setSaving(true)
    const now = new Date().toISOString()
    try {
      await saveSetting('printer_config', JSON.stringify(printer))
      await saveSetting('receipt_template', JSON.stringify(receipt))
      await saveSetting('receipt_layout', JSON.stringify(layout))
      await window.electronAPI.db.exec(`UPDATE stores SET name=?,address=?,phone=?,updated_at=? WHERE id=1`, [storeName, storeAddress, storePhone, now])
    } finally { setSaving(false) }
  }

  async function testPrint() {
    setTesting(true)
    try { await window.electronAPI.printer.testPrint() } catch (e) { toast.error(String(e)) }
    finally { setTesting(false) }
  }

  async function syncNow() {
    setSyncing(true)
    try {
      // 'users' has no server-side sync support (not a valid SyncEntityType) — employee
      // records are local-only for now.
      const tables = ['products', 'product_batches', 'product_stocks', 'collections', 'contacts', 'charges', 'settings']
      const results = await Promise.allSettled(tables.map((t) => window.electronAPI.sync.pullLatest(t)))
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed === 0) toast.success('Sync complete')
      else if (failed < tables.length) toast.warning(`Synced ${tables.length - failed}/${tables.length} tables`)
      else toast.error('Sync failed')
      await loadSettings()
    } finally { setSyncing(false) }
  }

  async function toggleCharge(id: number, active: number) {
    await window.electronAPI.db.exec(`UPDATE charges SET is_active=?,updated_at=? WHERE id=?`, [active ? 0 : 1, new Date().toISOString(), id])
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
        <h1 className="text-lg font-bold text-white">{t('nav.settings')}</h1>
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

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
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

        {/* Printer */}
        <div className={SECTION_CLS}>
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold text-sm">Thermal Printer</h2>
            <button onClick={testPrint} disabled={testing}
              className="flex items-center gap-2 border border-dark-border text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-xs transition-colors">
              <TestTube2 size={13} /> {testing ? 'Printing…' : 'Test Print'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL_CLS}>Connection Type</label>
              <Select
                value={printer.type}
                onChange={(v) => p('type', v as PrinterConfig['type'])}
                options={[
                  { value: 'usb', label: 'USB' },
                  { value: 'network', label: 'Network (IP)' },
                  { value: 'windows', label: 'Windows Printer' },
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
                  <label className={LABEL_CLS}>IP Address</label>
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
                <label className={LABEL_CLS}>Printer Name</label>
                <input value={printer.name} onChange={(e) => p('name', e.target.value)} placeholder="POS-58 Printer" className={INPUT_CLS} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Printer size={14} className="text-gray-500" />
            <span className="text-xs text-gray-500">Printer settings are applied immediately when you print</span>
          </div>
        </div>

        {/* Receipt Print Layout — only affects the "Windows Printer" path (printer.type === 'windows');
            direct USB/network ESC/POS printing has its own fixed layout. */}
        {printer.type === 'windows' && (
          <div className={SECTION_CLS}>
            <h2 className="text-white font-semibold text-sm">Receipt Print Layout</h2>
            <p className="text-xs text-gray-500 -mt-2">
              Tune these to match your paper roll and printer — sizes/margins vary by hardware and can't be
              previewed from here, so print a test receipt after each change.
            </p>

            <div className="grid grid-cols-3 gap-3">
              {([
                ['Paper Width (mm)', 'paperWidthMm', 1],
                ['Side Margin (mm)', 'marginMm', 0.5],
                ['Characters per Line', 'charWidth', 1],
              ] as Array<[string, 'paperWidthMm' | 'marginMm' | 'charWidth', number]>).map(([label, key, step]) => (
                <div key={key}>
                  <label className={LABEL_CLS}>{label}</label>
                  <input type="number" step={step} min={0} value={layout[key]}
                    onChange={(e) => l(key, Number(e.target.value) || 0)} className={INPUT_CLS} />
                </div>
              ))}
            </div>

            <div>
              <label className={LABEL_CLS}>Per-text size &amp; position</label>
              <p className="text-xs text-gray-600 mb-2">
                Position moves the text left (negative) or right (positive) in pixels, independent of size.
              </p>
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr,88px,96px] gap-2 px-1">
                  <span className="text-xs text-gray-500">Text</span>
                  <span className="text-xs text-gray-500">Size (px)</span>
                  <span className="text-xs text-gray-500">Position (px)</span>
                </div>
                {ELEMENT_LABELS.map(([key, label]) => (
                  <div key={key} className="grid grid-cols-[1fr,88px,96px] gap-2 items-center bg-dark-card rounded-lg px-3 py-2">
                    <span className="text-sm text-gray-300">{label}</span>
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
              Reset to defaults
            </button>
          </div>
        )}

        {/* Receipt */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm">Receipt Template</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Header Text</label>
              <textarea value={receipt.header} onChange={(e) => r('header', e.target.value)} rows={2}
                placeholder="e.g. Welcome to Baraka Market"
                className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary resize-none" />
            </div>
            <div>
              <label className={LABEL_CLS}>Footer Text</label>
              <textarea value={receipt.footer} onChange={(e) => r('footer', e.target.value)} rows={2}
                className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-primary resize-none" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {[
              { key: 'show_cashier', label: 'Show cashier name' },
              { key: 'show_barcode', label: 'Show barcode' },
              { key: 'show_logo', label: 'Show store logo' },
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
              <label className="text-sm text-gray-400">Copies:</label>
              <input type="number" min={1} max={3} value={receipt.copies} onChange={(e) => r('copies', Number(e.target.value))}
                className="w-16 bg-dark-card border border-dark-border rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-primary" />
            </div>
          </div>
        </div>

        {/* Taxes & Charges */}
        <div className={SECTION_CLS}>
          <h2 className="text-white font-semibold text-sm">Taxes & Charges</h2>
          {charges.length === 0 ? (
            <p className="text-gray-600 text-sm">No charges configured. Add them on the server.</p>
          ) : (
            <div className="space-y-2">
              {charges.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-dark-border/50 last:border-0">
                  <div>
                    <p className="text-white text-sm">{c.name}</p>
                    <p className="text-gray-500 text-xs">
                      {c.rate_type === 'percentage' ? `${Number(c.rate_value)}%` : `UZS ${fmtUZS(Number(c.rate_value))}`} · {c.rate_type}
                    </p>
                  </div>
                  <button onClick={() => toggleCharge(c.id, c.is_active)}
                    className={`w-9 h-5 rounded-full transition-colors relative ${c.is_active ? 'bg-primary' : 'bg-dark-border'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${c.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </BackOfficeLayout>
  )
}
