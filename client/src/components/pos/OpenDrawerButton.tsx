import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PinConfirmModal } from '../ui'
import { logAudit } from '../../lib/audit'

interface Props {
  className: string
  title?: string
  children: ReactNode
}

/**
 * Opens the cash drawer with no sale attached (e.g. to give change for a
 * banknote). Same gate as Settings > "Kassani ochish": the owner PIN when one
 * is set, and every opening goes to the audit log.
 */
export function OpenDrawerButton({ className, title, children }: Props) {
  const { t } = useTranslation()
  const [ownerPin, setOwnerPin] = useState('')
  const [askPin, setAskPin] = useState(false)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    window.electronAPI.db.query(
      `SELECT meta_value FROM settings WHERE meta_key='owner_expense_pin' LIMIT 1`, []
    ).then((rows) => setOwnerPin((rows as Array<{ meta_value: string }>)[0]?.meta_value ?? ''))
  }, [])

  async function openDrawer() {
    setOpening(true)
    try {
      const r = await window.electronAPI.printer.openCashDrawer()
      if (r.success) {
        toast.success(t('settings.drawerOpened'))
        await logAudit('drawer_open', { entity: 'drawer' })
      } else toast.error(r.error || t('settings.drawerFailed'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }

  return (
    <>
      <button
        onClick={() => (ownerPin ? setAskPin(true) : openDrawer())}
        disabled={opening}
        title={title}
        className={className}
      >
        {children}
      </button>
      {askPin && (
        <PinConfirmModal
          expectedPin={ownerPin}
          title={t('settings.openDrawer')}
          onClose={() => setAskPin(false)}
          onConfirmed={() => { setAskPin(false); openDrawer() }}
        />
      )}
    </>
  )
}
