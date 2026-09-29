import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'
import type { ReceiptDoc } from '@baraka/app-core'
import { Modal, Button } from '../ui'

interface Props {
  receipt: ReceiptDoc | null
  onClose: () => void
}

/**
 * Always-visible confirmation that a sale went through, regardless of
 * whether a physical receipt printer is configured on this terminal. The
 * receipt shown is the exact HTML printer.ipc.ts prints (same layout
 * settings, same paper width), so the screen and the paper can't drift apart.
 */
export function ReceiptModal({ receipt, onClose }: Props) {
  const { t } = useTranslation()
  const [printing, setPrinting] = useState(false)
  const [preview, setPreview] = useState<{ html: string; paperWidthMm: number } | null>(null)
  const [previewHeight, setPreviewHeight] = useState(0)

  useEffect(() => {
    setPreview(null)
    if (!receipt) return
    let cancelled = false
    window.electronAPI.printer.receiptHtml(receipt)
      .then((p) => { if (!cancelled) setPreview(p) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [receipt])

  if (!receipt) return null

  async function handlePrint() {
    setPrinting(true)
    try {
      const result = await window.electronAPI.printer.print(receipt)
      if (result.success) {
        toast.success(t('receipt.sentToPrinter'))
      } else {
        toast.error(result.error || t('receipt.noPrinterConfigured'), {
          description: t('receipt.setUpPrinterHint'),
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('receipt.printFailed'))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('receipt.saleComplete')}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button
            variant="secondary"
            className="flex-1"
            icon={Printer}
            loading={printing}
            onClick={handlePrint}
          >
            {t('receipt.print')}
          </Button>
          <Button className="flex-1" onClick={onClose}>{t('receipt.newSale')}</Button>
        </>
      }
    >
      <div className="max-h-[65vh] overflow-y-auto mx-4 mb-4 flex justify-center">
        {preview && (
          // No allow-scripts: the receipt is static markup; same-origin only
          // so onLoad can measure it and size the frame to the full receipt.
          <iframe
            title={t('receipt.saleComplete')}
            srcDoc={preview.html}
            sandbox="allow-same-origin"
            onLoad={(e) => setPreviewHeight(e.currentTarget.contentDocument?.documentElement.scrollHeight ?? 0)}
            className="block shrink-0 bg-white rounded-sm shadow-lg"
            style={{ width: `${preview.paperWidthMm}mm`, height: previewHeight }}
          />
        )}
      </div>
    </Modal>
  )
}
