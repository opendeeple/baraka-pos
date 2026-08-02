import { useEffect, useRef, useCallback } from 'react'
import { useCartStore } from '../store/cart.store'

type BarcodeHandler = (barcode: string) => void

// Accumulates keystrokes that arrive fast (HID barcode scanner sends all chars in <50ms each)
export function useBarcodeScanner(onScan?: BarcodeHandler) {
  const bufferRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { addItem } = useCartStore()

  const handleScan = useCallback(
    async (barcode: string) => {
      if (onScan) {
        onScan(barcode)
        return
      }
      // Default: look up product in SQLite and add to cart
      const rows = await window.electronAPI.db.query(
        `SELECT p.id, p.name, p.barcode, ps.quantity as stock,
                pb.id as batch_id, pb.price, pb.cost
         FROM products p
         JOIN product_batches pb ON pb.product_id = p.id AND pb.is_active = 1
         JOIN product_stocks ps ON ps.product_id = p.id AND ps.batch_id = pb.id
         WHERE p.barcode = ? AND p.is_active = 1
         LIMIT 1`,
        [barcode]
      ) as Array<{
        id: number; name: string; barcode: string; stock: number
        batch_id: number; price: number; cost: number
      }>

      if (rows.length === 0) {
        window.electronAPI.barcode.manualScan(barcode)
        return
      }

      const p = rows[0]
      addItem({
        productId: p.id,
        batchId: p.batch_id,
        name: p.name,
        barcode: p.barcode,
        unitPrice: p.price,
        unitCost: p.cost,
        quantity: 1,
        freeQuantity: 0,
        discount: 0,
        isFree: false,
        maxStock: p.stock,
      })
    },
    [onScan, addItem]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim()
        bufferRef.current = ''
        if (timerRef.current) clearTimeout(timerRef.current)
        if (code.length >= 3) handleScan(code)
        return
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          // Scanner didn't send Enter — flush anyway after 150ms idle
          const code = bufferRef.current.trim()
          bufferRef.current = ''
          if (code.length >= 8) handleScan(code)
        }, 150)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleScan])
}
