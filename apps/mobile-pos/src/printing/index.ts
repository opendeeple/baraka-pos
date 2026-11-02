import type { ReceiptDoc } from '@baraka/app-core'
import type { PrinterDriver, PrinterConfig } from './PrinterDriver'
import { networkDriver } from './network.driver'
import { printViaSystemDialog } from './systemPrint'

export type { PrinterConfig, PrinterDriver } from './PrinterDriver'
export { printViaSystemDialog, shareReceiptPdf } from './systemPrint'

// Bluetooth Classic (react-native-bluetooth-classic) and the Sunmi inner
// printer need physical hardware to implement and validate; they slot in here
// behind the same PrinterDriver interface without touching call sites.
const notImplemented = (kind: string): PrinterDriver => ({
  print: async () => {
    throw new Error(`${kind} printing requires a device build with the ${kind} driver — use a network printer for now`)
  },
  probe: async () => false,
})

// Hands off to Android's own print framework (see systemPrint.ts) instead of
// a driver BarakaPOS maintains — "probe" can't check reachability ahead of
// time (there's no fixed target), so it just reports available.
const systemDriver: PrinterDriver = {
  print: (doc, config) => printViaSystemDialog(doc, config.width ?? 32),
  probe: async () => true,
}

const DRIVERS: Record<Exclude<PrinterConfig['type'], 'none'>, PrinterDriver> = {
  network: networkDriver,
  bluetooth: notImplemented('Bluetooth'),
  sunmi: notImplemented('Sunmi'),
  system: systemDriver,
}

export async function printReceipt(doc: ReceiptDoc, config: PrinterConfig | null): Promise<void> {
  if (!config || config.type === 'none') return
  await DRIVERS[config.type].print(doc, config)
}

export async function probePrinter(config: PrinterConfig | null): Promise<boolean> {
  if (!config || config.type === 'none') return false
  return DRIVERS[config.type].probe(config)
}
