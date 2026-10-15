import { generateInternalBarcode } from './labels'

/**
 * Alias barcodes (an older batch's packaging, a supplier's own code)
 * registered against a product alongside its primary products.barcode —
 * scanning either one should resolve to the same product. Screens that load
 * their whole product catalog up front and match a scan client-side load
 * this once alongside it, falling back to it when a code doesn't match any
 * product's primary barcode.
 */
export async function loadBarcodeAliasMap(): Promise<Map<string, number>> {
  const rows = await window.electronAPI.db.query(
    `SELECT product_id, barcode FROM product_barcodes WHERE deleted_at IS NULL`, []
  ) as Array<{ product_id: number; barcode: string }>
  return new Map(rows.map((r) => [r.barcode, r.product_id]))
}

/** A fresh in-store EAN-13, retried a few times against both barcode tables in the unlikely case of a collision. */
export async function generateUniqueBarcode(): Promise<string> {
  let code = generateInternalBarcode()
  for (let i = 0; i < 5; i++) {
    const [dup] = await window.electronAPI.db.query(
      `SELECT 1 AS x FROM products WHERE barcode = ? UNION SELECT 1 FROM product_barcodes WHERE barcode = ? AND deleted_at IS NULL`,
      [code, code]
    ) as unknown[]
    if (!dup) break
    code = generateInternalBarcode()
  }
  return code
}
