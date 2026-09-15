import { useEffect, useRef } from 'react'

type BarcodeHandler = (barcode: string) => void

// Accumulates keystrokes that arrive fast (HID barcode scanner sends all chars in <50ms each).
// Product lookup + cart-add is the caller's job (POSScreen.handleBarcodeScanned) — this hook
// only detects "a scan happened" and hands the raw code to onScan. Keeping the lookup in one
// place avoids two barcode queries drifting out of sync with each other.
export function useBarcodeScanner(onScan: BarcodeHandler) {
  const bufferRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim()
        bufferRef.current = ''
        if (timerRef.current) clearTimeout(timerRef.current)
        if (code.length >= 3) onScanRef.current(code)
        return
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          // Scanner didn't send Enter — flush anyway after 150ms idle
          const code = bufferRef.current.trim()
          bufferRef.current = ''
          if (code.length >= 8) onScanRef.current(code)
        }, 150)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
