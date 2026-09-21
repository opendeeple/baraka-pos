import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer, CheckCircle2, MapPin, Phone, Receipt as ReceiptIcon, Clock, User } from 'lucide-react'
import { toast } from 'sonner'
import type { ReceiptDoc } from '@baraka/app-core'
import { Modal, Button } from '../ui'

interface Props {
  receipt: ReceiptDoc | null
  onClose: () => void
}

const PAYMENT_METHOD_KEYS: Record<string, string> = {
  Cash: 'payment.methodCash',
  Card: 'payment.methodCard',
  Click: 'payment.methodClick',
  Debt: 'payment.methodDebt',
}

/**
 * Always-visible confirmation that a sale went through, regardless of
 * whether a physical receipt printer is configured on this terminal. Purely
 * a screen UI — the print pipeline (printer.ipc.ts) renders its own,
 * separately-constrained HTML/ESC-POS output for the physical paper and
 * doesn't use any of this component's markup.
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

  const dateTime = receipt.timestamp.slice(0, 16).replace('T', '  ')
  const methodLabel = (method: string) =>
    t(PAYMENT_METHOD_KEYS[method] ?? '', { defaultValue: method })

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
      <div className="max-h-[65vh] overflow-y-auto mx-4 mb-4 rounded-xl bg-white text-gray-900 overflow-hidden">
        {/* Header: success mark + store identity */}
        <div className="bg-primary/10 flex flex-col items-center gap-2 py-5 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shrink-0">
            <CheckCircle2 className="text-white" size={24} />
          </div>
          <div className="font-bold text-lg leading-tight">{receipt.storeName}</div>
          {(receipt.storeAddress || receipt.storePhone) && (
            <div className="flex flex-col items-center gap-0.5 text-xs text-gray-500">
              {receipt.storeAddress && (
                <span className="flex items-center gap-1"><MapPin size={12} />{receipt.storeAddress}</span>
              )}
              {receipt.storePhone && (
                <span className="flex items-center gap-1"><Phone size={12} />{receipt.storePhone}</span>
              )}
            </div>
          )}
          {receipt.header && <div className="text-xs text-gray-600 italic">{receipt.header}</div>}
        </div>

        {/* Invoice meta */}
        <div className="px-4 py-2.5 border-y border-dashed border-gray-300 flex items-center justify-between text-[11px] text-gray-500">
          <span className="flex items-center gap-1"><ReceiptIcon size={12} />№{receipt.invoiceNumber}</span>
          <span className="flex items-center gap-1"><Clock size={12} />{dateTime}</span>
        </div>
        {receipt.cashierName && (
          <div className="px-4 pt-2 flex items-center gap-1 text-[11px] text-gray-500">
            <User size={12} />{t('receipt.cashier')}: {receipt.cashierName}
          </div>
        )}

        {/* Items */}
        <div className="px-4 py-3">
          <div className="grid grid-cols-[1.5em,1fr,auto,auto] gap-x-2 pb-1.5 mb-1.5 border-b border-gray-200 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
            <span>№</span>
            <span>{t('receipt.itemHeader')}</span>
            <span className="text-right">{t('common.quantity')}</span>
            <span className="text-right">{t('common.total')}</span>
          </div>
          {receipt.items.map((item, i) => (
            <div
              key={i}
              className="grid grid-cols-[1.5em,1fr,auto,auto] gap-x-2 py-1.5 text-sm border-b border-gray-100 last:border-0"
            >
              <span className="text-gray-400">{i + 1}</span>
              <span className="truncate pr-1">{item.name}</span>
              <span className="text-right text-gray-400 whitespace-nowrap text-xs self-center">
                {item.quantity}×{item.price.toLocaleString()}
              </span>
              <span className="text-right font-medium whitespace-nowrap">
                {(item.quantity * item.price).toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="px-4 py-3 border-t border-dashed border-gray-300 space-y-1">
          {receipt.charges.map((c, i) => (
            <div key={i} className="flex justify-between text-sm text-gray-600">
              <span>{c.name}</span>
              <span>{c.amount.toLocaleString()}</span>
            </div>
          ))}
          {!!receipt.discount && (
            <div className="flex justify-between text-sm text-red-500">
              <span>{t('sales.discount')}</span>
              <span>-{receipt.discount.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-1.5">
            <span className="font-semibold">{t('common.total')}</span>
            <span className="text-xl font-bold text-primary">{receipt.total.toLocaleString()}</span>
          </div>
          {receipt.payments.map((p, i) => (
            <div key={i} className="flex justify-between text-xs text-gray-500">
              <span>{methodLabel(p.method)}</span>
              <span>{p.amount.toLocaleString()}</span>
            </div>
          ))}
          {receipt.change > 0 && (
            <div className="flex justify-between text-xs text-gray-500">
              <span>{t('payment.change')}</span>
              <span>{receipt.change.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-4 text-center text-xs text-gray-400 border-t border-dashed border-gray-300">
          {receipt.footer || t('receipt.defaultThanks')}
        </div>
      </div>
    </Modal>
  )
}
