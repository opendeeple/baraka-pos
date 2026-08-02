import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCartStore } from '../../store/cart.store'
import CategorySidebar from '../../components/pos/CategorySidebar'
import ProductGrid, { LocalProduct } from '../../components/pos/ProductGrid'
import CartPanel from '../../components/pos/CartPanel'
import TopBar from '../../components/layout/TopBar'
import AppLauncherBar, { PosApp } from '../../components/pos/AppLauncherBar'
import AppWebView from '../../components/pos/AppWebView'
import PaymentScreen from './PaymentScreen'
import { useBarcodeScanner } from '../../hooks/useBarcode'
import { useSync } from '../../hooks/useSync'
import { useWebSocket } from '../../hooks/useWebSocket'

export default function POSScreen() {
  const navigate = useNavigate()
  const { addItem, loadHeldCarts } = useCartStore()
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [products, setProducts] = useState<LocalProduct[]>([])
  const [showPayment, setShowPayment] = useState(false)
  const [openApps, setOpenApps] = useState<PosApp[]>([])
  const [activeAppId, setActiveAppId] = useState<string | null>(null)

  // Startup sync + periodic refresh
  useSync()

  // WebSocket: refresh products on stock/product updates from other terminals
  useWebSocket({
    onStockUpdated: () => loadProducts(),
    onProductUpdated: () => loadProducts(),
  })

  // HID barcode scanner
  useBarcodeScanner()

  useEffect(() => {
    loadHeldCarts()
    loadProducts()
  }, [])

  useEffect(() => {
    loadProducts()
  }, [selectedCategory])

  // IPC barcode events (from preload)
  useEffect(() => {
    const unsubscribe = window.electronAPI.barcode.onScan((barcode) => {
      handleBarcodeScanned(barcode)
    })
    return unsubscribe
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
             pb.id as batch_id, pb.price, pb.cost,
             COALESCE(ps.quantity, 0) as stock
      FROM products p
      LEFT JOIN product_batches pb ON pb.product_id = p.id AND pb.is_active = 1
      LEFT JOIN product_stocks ps ON ps.product_id = p.id AND ps.batch_id = pb.id
      WHERE p.is_active = 1 AND p.deleted_at IS NULL
    `
    const params: unknown[] = []

    if (selectedCategory !== null) {
      sql += ` AND p.category_id = ?`
      params.push(selectedCategory)
    }
    sql += ` ORDER BY p.name LIMIT 200`
    const rows = await window.electronAPI.db.query(sql, params) as LocalProduct[]
    setProducts(rows)
  }

  async function handleBarcodeScanned(barcode: string) {
    const rows = await window.electronAPI.db.query(
      `SELECT p.id, p.name, p.barcode, pb.id as batch_id, pb.price, pb.cost,
              COALESCE(ps.quantity,0) as stock
       FROM products p
       JOIN product_batches pb ON pb.product_id = p.id AND pb.is_active = 1
       LEFT JOIN product_stocks ps ON ps.product_id = p.id AND ps.batch_id = pb.id
       WHERE p.barcode = ? AND p.is_active = 1 LIMIT 1`,
      [barcode]
    ) as LocalProduct[]
    if (rows.length > 0) addToCart(rows[0])
  }

  function addToCart(product: LocalProduct) {
    addItem({
      productId: product.id,
      batchId: product.batch_id ?? 0,
      name: product.name,
      barcode: product.barcode,
      imageUrl: product.image_url,
      quantity: 1,
      freeQuantity: 0,
      unitPrice: product.price ?? 0,
      unitCost: product.cost ?? 0,
      discount: 0,
      notes: '',
      isFree: false,
      maxStock: product.stock ?? 0,
    })
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
      <TopBar />

      <div className="flex flex-1 overflow-hidden relative">
        <AppLauncherBar onOpenApp={handleOpenApp} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <CategorySidebar
            selectedCategory={selectedCategory}
            onSelect={setSelectedCategory}
          />
          <div className="flex-1 overflow-auto p-3">
            <ProductGrid products={products} onAddToCart={addToCart} />
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
    </div>
  )
}
