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
