import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { renderReceiptHtml, type ReceiptDoc } from '@baraka/app-core'

/**
 * Hands the receipt to Android's own print framework instead of a driver
 * BarakaPOS writes itself — the system dialog lists every print-capable app
 * already on the phone, including a Bluetooth/USB thermal printer's own
 * vendor app if it registers as a print service. Needs user interaction
 * (picking a target) every time; Android has no headless/silent print API.
 */
export async function printViaSystemDialog(doc: ReceiptDoc, width: 32 | 48 = 32): Promise<void> {
  await Print.printAsync({ html: renderReceiptHtml(doc, width) })
}

/** Renders the receipt to a PDF file and opens the share sheet — "save as
 *  PDF", send over Telegram/WhatsApp, or hand off to a printer's own app
 *  that accepts files instead of the system print dialog. */
export async function shareReceiptPdf(doc: ReceiptDoc, width: 32 | 48 = 32): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: renderReceiptHtml(doc, width), base64: false })
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device')
  }
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Receipt ${doc.invoiceNumber}` })
}
