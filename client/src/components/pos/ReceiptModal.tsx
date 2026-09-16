import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'
import { renderReceiptText, type ReceiptDoc } from '@baraka/app-core'
import { Modal, Button } from '../ui'

interface Props {
  receipt: ReceiptDoc | null
  onClose: () => void
}

/**
 * Always-visible confirmation that a sale went through, regardless of
 * whether a physical receipt printer is configured on this terminal — the
 * text below mirrors what a configured printer would actually output
 * (same renderReceiptText formatter used by the ESC/POS driver).
 */
export function ReceiptModal({ receipt, onClose }: Props) {
  const { t } = useTranslation()
  const [printing, setPrinting] = useState(false)
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
      <div className="p-4 max-h-[60vh] overflow-y-auto bg-white rounded-lg mx-4 mb-4 text-center">
        {/* 28 cols — must match printer.ipc.ts's RECEIPT_CHAR_WIDTH so line breaks match what prints.
            inline-block + parent text-center: centers the whole block without disturbing the
            receipt's own internal left/right column alignment (already space-padded per line). */}
        <pre className="inline-block text-left text-black text-xs leading-relaxed font-mono whitespace-pre-wrap p-4">
          {renderReceiptText(receipt, 28)}
        </pre>
      </div>
    </Modal>
  )
}
