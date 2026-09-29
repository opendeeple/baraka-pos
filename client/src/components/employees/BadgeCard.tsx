import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ScanBarcode, Printer, RefreshCw, CloudOff } from 'lucide-react'
import { Modal, Button } from '../ui'
import { badgeHtml, BADGE_WIDTH_MM, BADGE_HEIGHT_MM } from '../../lib/badge'
import { generateBadgeCode } from '../../lib/code39'

export interface BadgeEmployee {
  id: number
  sync_id: string
  name: string
  badge_code?: string | null
  /** 1 while the latest change hasn't reached the server — the badge won't work until it has. */
  sync_pending?: number
  server_id?: number | null
}

interface Props {
  employee: BadgeEmployee
  storeName: string
  position: string
  onChanged: () => void
}

/**
 * The employee's scannable badge: generate a code, preview the printable
 * card (the exact HTML that prints), print it, or replace a lost one.
 */
export function BadgeCard({ employee, storeName, position, onChanged }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)

  const html = employee.badge_code
    ? badgeHtml({ storeName, employeeName: employee.name, position, badgeCode: employee.badge_code })
    : null
  const notOnServer = !employee.server_id || !!employee.sync_pending

  async function assignNewCode() {
    setBusy(true)
    try {
      let code = generateBadgeCode()
      // The server's unique index is the real guard; this just avoids a
      // pointless round-trip failure in the (astronomically rare) local clash.
      while ((await window.electronAPI.db.query(`SELECT 1 FROM users WHERE badge_code=?`, [code])).length) {
        code = generateBadgeCode()
      }
      await window.electronAPI.db.exec(
        `UPDATE users SET badge_code=?, updated_at=? WHERE id=?`,
        [code, new Date().toISOString(), employee.id]
      )
      await window.electronAPI.sync.enqueue('users', employee.sync_id, 'upsert')
      onChanged()
      // The badge only works once the server has it — push now, not on the next sync tick.
      window.electronAPI.sync.pushPending().catch(() => {}).finally(onChanged)
    } finally {
      setBusy(false)
      setConfirmReplace(false)
    }
  }

  async function print() {
    if (!html) return
    const result = await window.electronAPI.printer.printBadge(html)
    if (!result.success && result.error) toast.error(result.error)
  }

  return (
    <div className="bg-dark-surface border border-dark-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <ScanBarcode size={15} className="text-primary" />
          {t('employees.badge')}
        </h3>
        {html && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setConfirmReplace(true)} disabled={busy}>
              {t('employees.badgeReplace')}
            </Button>
            <Button size="sm" icon={Printer} onClick={print}>{t('employees.badgePrint')}</Button>
          </div>
        )}
      </div>

      {html ? (
        <div className="flex flex-col items-start gap-3">
          <iframe
            title={t('employees.badge')}
            srcDoc={html}
            sandbox="allow-same-origin"
            className="block bg-white rounded-md shadow-lg"
            style={{ width: `${BADGE_WIDTH_MM}mm`, height: `${BADGE_HEIGHT_MM}mm` }}
          />
          <p className="text-xs text-gray-500">{t('employees.badgeHint')}</p>
          {notOnServer && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <CloudOff size={13} className="shrink-0" />
              {t('employees.badgeNotSynced')}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center text-center gap-3 py-6">
          <p className="text-gray-500 text-sm">{t('employees.badgeNone')}</p>
          <Button icon={ScanBarcode} loading={busy} onClick={assignNewCode}>{t('employees.badgeGenerate')}</Button>
        </div>
      )}

      <Modal
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        title={t('employees.badgeReplace')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmReplace(false)}>{t('common.cancel')}</Button>
            <Button className="flex-1" loading={busy} onClick={assignNewCode}>{t('common.confirm')}</Button>
          </>
        }
      >
        <p className="p-5 text-sm text-gray-400">{t('employees.badgeReplaceConfirm')}</p>
      </Modal>
    </div>
  )
}
