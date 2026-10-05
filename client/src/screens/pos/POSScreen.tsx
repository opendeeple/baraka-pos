import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { useCartStore } from '../../store/cart.store'
import CategorySidebar from '../../components/pos/CategorySidebar'
import ProductGrid, { LocalProduct } from '../../components/pos/ProductGrid'
import CartPanel from '../../components/pos/CartPanel'
import TopBar from '../../components/layout/TopBar'
import AppLauncherBar, { PosApp } from '../../components/pos/AppLauncherBar'
import AppWebView from '../../components/pos/AppWebView'
import PaymentScreen from './PaymentScreen'
import { QuickAddProductModal } from '../../components/pos/QuickAddProductModal'
import { UnitCalculatorModal } from '../../components/pos/UnitCalculatorModal'
import { useBarcodeScanner } from '../../hooks/useBarcode'
import { useSync } from '../../hooks/useSync'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { SCALE_SETTING_KEY, parseScaleBarcode, pluVariants, readScaleConfig } from '../../lib/scaleBarcode'

export default function POSScreen() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { addItem, loadHeldCarts } = useCartStore()
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [products, setProducts] = useState<LocalProduct[]>([])
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [openApps, setOpenApps] = useState<PosApp[]>([])
  const [activeAppId, setActiveAppId] = useState<string | null>(null)
  const [categoryRefreshKey, setCategoryRefreshKey] = useState(0)
  const [quickAddBarcode, setQuickAddBarcode] = useState<string | null>(null)
  const [calculatorProduct, setCalculatorProduct] = useState<LocalProduct | null>(null)

  // Startup sync + periodic refresh
  const { pullAll, pullTables, pushPending } = useSync()

  async function handleManualRefresh() {
    await pushPending()
    await pullAll()
    loadProducts()
    toast.success(t('pos.dataRefreshed'))
  }

  // WebSocket: refresh products on stock/product updates from other terminals.
  // onSyncChanged fires for ANY successful push from ANY device (e.g. a new
  // product added in Office) — pull the tables it names and reload
  // immediately instead of waiting for the 5-minute poll or a manual refresh.
  useWebSocket({
    onStockUpdated: () => loadProducts(),
    onProductUpdated: () => loadProducts(),
    onSyncChanged: async (tables) => {
      await pullTables(tables)
      loadProducts()
      if (tables.includes('collections')) setCategoryRefreshKey((k) => k + 1)
    },
  })

  // HID barcode scanner — same lookup used everywhere a scan can land (this
  // global listener, and Enter in the search box below).
  useBarcodeScanner(async (barcode) => {
    if (!(await handleBarcodeScanned(barcode))) {
      setQuickAddBarcode(barcode)
    }
  })

  useEffect(() => {
    loadHeldCarts()
  }, [])

  useEffect(() => {
    loadProducts()
  }, [selectedCategory, debouncedSearch])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'F5') { e.preventDefault(); setShowPayment(true) }
if (e.key === 'F4') { e.preventDefault(); useCartStore.getState().holdCart() }
      if (e.key === 'Escape') setShowPayment(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  async function loadProducts() {
    let sql = `
      SELECT p.id, p.name, p.barcode, p.image_url, p.category_id,
             p.is_stock_managed, p.is_active, p.alert_quantity,
             p.unit, p.units_per_package,
             pb.id as batch_id, pb.price, pb.cost,
             COALESCE(ps.quantity, 0) as stock
      FROM products p
      LEFT JOIN product_batches pb ON pb.id = (
        SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
      )
      LEFT JOIN product_stocks ps ON ps.id = (
        SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'shop' ORDER BY id DESC LIMIT 1
      )
      WHERE p.is_active = 1 AND p.deleted_at IS NULL
    `
    const params: unknown[] = []

    if (selectedCategory !== null) {
      sql += ` AND p.category_id = ?`
      params.push(selectedCategory)
    }
    if (debouncedSearch.trim()) {
      sql += ` AND (p.name LIKE ? OR p.barcode LIKE ?)`
      const q = `%${debouncedSearch.trim()}%`
      params.push(q, q)
    }
    sql += ` ORDER BY p.name LIMIT 200`
    const rows = await window.electronAPI.db.query(sql, params) as LocalProduct[]
    setProducts(rows)
  }

  /** Exact barcode lookup — used by the HID scanner and by Enter in the search box. Returns whether a product was found and added. */
  async function handleBarcodeScanned(barcode: string): Promise<boolean> {
    const lookup = (where: string, params: unknown[]) => window.electronAPI.db.query(
      `SELECT p.id, p.name, p.barcode, p.unit, p.units_per_package, pb.id as batch_id, pb.price, pb.cost,
              COALESCE(ps.quantity,0) as stock
       FROM products p
       JOIN product_batches pb ON pb.id = (
         SELECT id FROM product_batches WHERE product_id = p.id AND is_active = 1 ORDER BY id DESC LIMIT 1
       )
       LEFT JOIN product_stocks ps ON ps.id = (
         SELECT id FROM product_stocks WHERE product_id = p.id AND batch_id = pb.id AND location = 'shop' ORDER BY id DESC LIMIT 1
       )
       WHERE ${where} AND p.is_active = 1 AND p.deleted_at IS NULL LIMIT 1`,
      params
    ) as Promise<LocalProduct[]>
    const rows = await lookup('p.barcode = ?', [barcode])
    if (rows.length > 0) { handleProductTap(rows[0]); return true }

    // A weighing-scale label (no product has this exact barcode): the
    // product by its PLU, the weight straight into the cart.
    const [cfgRow] = await window.electronAPI.db.query(
      `SELECT meta_value FROM settings WHERE meta_key = ?`, [SCALE_SETTING_KEY]
    ) as Array<{ meta_value: string }>
    const scale = parseScaleBarcode(barcode, readScaleConfig(cfgRow?.meta_value))
    if (!scale) return false
    const plus = pluVariants(scale.plu)
    const marks = plus.map(() => '?').join(',')
    const [weighed] = await lookup(`(p.sku IN (${marks}) OR p.barcode IN (${marks}))`, [...plus, ...plus])
    if (!weighed) {
      toast.error(t('pos.scalePluNotFound', { plu: scale.plu }))
      return true // it was a scale label — don't offer to create a product from it
    }
    addToCart(weighed, scale.weightKg)
    return true
  }

  /** Enter in the search box: if it's an exact barcode match, add it straight to the cart and
   *  clear the box (scan-to-checkout flow). Otherwise offer the quick-add flow — a HID scanner
   *  focused on this input (the global useBarcodeScanner listener ignores INPUT/TEXTAREA targets
   *  on purpose, to avoid double-handling the same keystrokes) has to trigger it from here. */
  async function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = search.trim()
    if (!term) return
    if (await handleBarcodeScanned(term)) {
      setSearch('')
      searchInputRef.current?.focus()
    } else {
      setQuickAddBarcode(term)
    }
  }

  /** Tapping a product card in the grid — routes kg/box-priced products to
   *  the unit calculator instead of adding a flat quantity of 1. */
  function handleProductTap(product: LocalProduct) {
    if (product.unit === 'kg' || product.unit === 'box') {
      setCalculatorProduct(product)
      return
    }
    addToCart(product)
  }

  /** Always adds directly with the given quantity — used by the calculator
   *  (already-computed kg/box fraction) and the quick-add-on-scan flow.
   *  Only what's on the shop shelf can be sold: goods enter the system (a
   *  delivery, or quick-add with its quantity) before they're sold. */
  function addToCart(product: LocalProduct, quantity = 1) {
    const managed = product.is_stock_managed !== 0
    const stock = Number(product.stock ?? 0)
    if (managed && stock <= 0) {
      toast.error(t('pos.cannotSellNoStock', { name: product.name }))
      return
    }
    const result = addItem({
      productId: product.id,
      batchId: product.batch_id ?? 0,
      name: product.name,
      barcode: product.barcode,
      imageUrl: product.image_url,
      quantity,
      freeQuantity: 0,
      unitPrice: product.price ?? 0,
      unitCost: product.cost ?? 0,
      discount: 0,
      notes: '',
      isFree: false,
      maxStock: managed ? stock : undefined,
    })
    if (result === 'capped') toast.warning(t('pos.onlyInStock', { name: product.name, count: stock }))
  }

  function handleOpenApp(app: PosApp) {
    setOpenApps((prev) => (prev.some((a) => a.id === app.id) ? prev : [...prev, app]))
    setActiveAppId(app.id)
  }

  function handleCloseApp(appId: string) {
    setOpenApps((prev) => prev.filter((a) => a.id !== appId))
    if (activeAppId === appId) setActiveAppId(null)
  }

  if (showPayment) {
    return (
      <PaymentScreen
        onClose={() => setShowPayment(false)}
        onComplete={() => setShowPayment(false)}
      />
    )
  }

  return (
    <div className="h-screen flex flex-col bg-dark overflow-hidden">
      <TopBar onRefresh={handleManualRefresh} />

      <div className="flex flex-1 overflow-hidden relative">
        <AppLauncherBar onOpenApp={handleOpenApp} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="shrink-0 px-3 pt-3 pb-1">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('pos.searchPlaceholder')}
                className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <CategorySidebar
            selectedCategory={selectedCategory}
            onSelect={setSelectedCategory}
            refreshKey={categoryRefreshKey}
          />
          <div className="flex-1 overflow-auto p-3">
            <ProductGrid products={products} onAddToCart={handleProductTap} />
          </div>
        </div>
        <CartPanel onCheckout={() => setShowPayment(true)} onCloseRegister={() => navigate('/session/close')} />

        {openApps.map((app) => (
          <AppWebView
            key={app.id}
            app={app}
            visible={app.id === activeAppId}
            onClose={() => handleCloseApp(app.id)}
          />
        ))}
      </div>

      {quickAddBarcode !== null && (
        <QuickAddProductModal
          barcode={quickAddBarcode}
          onClose={() => setQuickAddBarcode(null)}
          onCreated={(product) => {
            setQuickAddBarcode(null)
            addToCart(product)
            loadProducts()
          }}
        />
      )}

      {calculatorProduct && (
        <UnitCalculatorModal
          product={calculatorProduct}
          onClose={() => setCalculatorProduct(null)}
          onAdd={(quantity) => {
            addToCart(calculatorProduct, quantity)
            setCalculatorProduct(null)
          }}
        />
      )}
    </div>
  )
}
