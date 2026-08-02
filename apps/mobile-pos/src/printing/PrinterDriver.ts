import type { ReceiptDoc } from '@baraka/app-core'

export interface PrinterConfig {
  type: 'network' | 'bluetooth' | 'sunmi' | 'none'
  /** network: printer IP; bluetooth: bonded MAC address */
  address?: string
  port?: number
  width?: 32 | 48
}

export interface PrinterDriver {
  print(doc: ReceiptDoc, config: PrinterConfig): Promise<void>
  /** Connectivity check for the Settings test-print button. */
  probe(config: PrinterConfig): Promise<boolean>
}

// Minimal ESC/POS byte builder over the plain-text renderer: init, text,
// feed+cut, optional drawer kick. Enough for generic 58/80mm printers; a
// richer encoder (styles, QR, logo) can replace this without touching drivers.
import { renderReceiptText } from '@baraka/app-core'

export function encodeEscPos(doc: ReceiptDoc, width: 32 | 48 = 32): Uint8Array {
  const ESC = 0x1b
  const GS = 0x1d
  const text = renderReceiptText(doc, width) + '\n\n\n\n'
  const textBytes = new TextEncoder().encode(text)
  const init = [ESC, 0x40] // ESC @
  const cut = [GS, 0x56, 0x00] // GS V full cut
  const drawer = doc.openDrawer ? [ESC, 0x70, 0x00, 0x19, 0xfa] : [] // ESC p
  const out = new Uint8Array(init.length + textBytes.length + cut.length + drawer.length)
  out.set(init, 0)
  out.set(textBytes, init.length)
  out.set(cut, init.length + textBytes.length)
  out.set(drawer, init.length + textBytes.length + cut.length)
  return out
}
