import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { fmtUZS } from '@baraka/app-core'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import type { CategoryItem, ProductListItem } from '@baraka/data'
import { Button, Dialog, Icon, Input, Screen, Sheet, toast, useTheme } from '@baraka/mobile-ui'
import { breakpoints, opacity, radius, spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { BarcodeScannerModal } from '../components/BarcodeScannerModal'
import { ProductGrid } from './register/ProductGrid'
import { CartPanel } from './register/CartPanel'
import { DiscountDialog } from './register/DiscountDialog'
import type { RootStackParamList } from '../navigation'

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>

export function RegisterScreen({ navigation }: Props) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { repos, useCartStore, engine } = getServices()
  const { width } = useWindowDimensions()
  const twoPane = width >= breakpoints.twoPane

  const [products, setProducts] = useState<ProductListItem[]>([])
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [stockWarning, setStockWarning] = useState<{ product: ProductListItem; message: string } | null>(null)

  // Selector subscriptions: the coordinator needs only the cart-bar numbers,
  // not the whole store (kills the old full-screen re-render per keystroke).
  const addItem = useCartStore((s) => s.addItem)
  const cartItems = useCartStore((s) => s.items)
  const holdCart = useCartStore((s) => s.holdCart)
  const setDiscount = useCartStore((s) => s.setDiscount)
  const cartDiscount = useCartStore((s) => s.discount)
  const getSubtotal = useCartStore((s) => s.getSubtotal)
  const getTotalChargeAmount = useCartStore((s) => s.getTotalChargeAmount)
  const getFinalTotal = useCartStore((s) => s.getFinalTotal)
  const loadHeldCarts = useCartStore((s) => s.loadHeldCarts)

  const total = getFinalTotal()
  const itemCount = cartItems.reduce((s, i) => s + i.quantity, 0)

  const load = useCallback(() => {
    setProducts(repos.products.list({ search: search || undefined, categoryId: categoryId ?? undefined }))
  }, [search, categoryId])

  useEffect(() => {
    setCategories(repos.products.categories())
    loadHeldCarts()
    // Background sync cycle on entry: full pull order (users included — session
    // pushes need them for userSyncId resolution), then flush the outbox.
    const syncCycle = async () => {
      try {
        for (const table of PULL_TABLE_ORDER) {
          await engine.pullTableV2(table)
        }
        await engine.flushOutbox()
        load()
      } catch { /* offline — local data is authoritative */ }
    }
    syncCycle()
    const flushInterval = setInterval(() => { engine.flushOutbox().catch(() => {}) }, 60_000)
    return () => clearInterval(flushInterval)
  }, [])

  useEffect(load, [load])

  const doAdd = useCallback(
    (p: ProductListItem) => {
      addItem({
        productId: p.id,
        batchId: p.batchId,
        name: p.name,
        quantity: 1,
        unitPrice: p.price,
        unitCost: p.cost,
        discount: 0,
      } as never)
    },
    [addItem]
  )

  const addProduct = useCallback(
    (p: ProductListItem) => {
      if (!p.batchId) return
      // Stock is advisory, not blocking (Odoo/OSPOS stance): the shelf is the
      // source of truth in a mini-market — warn on oversell, let the cashier
      // decide, and let the sync-side clamp keep the numbers sane.
      if (p.isStockManaged) {
        const inCart = cartItems
          .filter((i) => i.productId === p.id && i.batchId === p.batchId)
          .reduce((s, i) => s + i.quantity, 0)
        if (inCart + 1 > p.stock) {
          setStockWarning({
            product: p,
            message: `${p.name}: system shows ${p.stock} in stock${inCart ? ` (${inCart} already in cart)` : ''}. Sell anyway?`,
          })
          return
        }
      }
      doAdd(p)
    },
    [cartItems, doAdd]
  )

  function submitBarcode(code: string): boolean {
    const hit = repos.products.findByBarcode(code.trim())
    if (hit) {
      addProduct(hit)
      return true
    }
    return false
  }

  const gridPane = (
    <View style={styles.gridPane}>
      <View style={styles.searchRow}>
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Search or scan barcode…"
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
          onSubmitEditing={() => {
            if (submitBarcode(search)) setSearch('')
          }}
        />
        <Button title="Scan" icon="scan" onPress={() => setScannerOpen(true)} />
      </View>
      <ProductGrid
        products={products}
        categories={categories}
        categoryId={categoryId}
        onCategory={setCategoryId}
        onAdd={addProduct}
        twoPane={twoPane}
      />
    </View>
  )

  const modals = (
    <>
      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(code) => {
          if (!submitBarcode(code)) toast.error(`No product for barcode ${code}`)
        }}
      />
      <DiscountDialog
        visible={discountOpen}
        initial={cartDiscount}
        maxAmount={getSubtotal() + getTotalChargeAmount()}
        onApply={(v) => { setDiscount(v); setDiscountOpen(false) }}
        onClose={() => setDiscountOpen(false)}
      />
      <Dialog
        visible={stockWarning !== null}
        onClose={() => setStockWarning(null)}
        title="Stock warning"
        message={stockWarning?.message ?? ''}
        actions={[
          { label: 'Cancel', onPress: () => setStockWarning(null) },
          {
            label: 'Sell anyway',
            tone: 'primary',
            onPress: () => {
              if (stockWarning) doAdd(stockWarning.product)
              setStockWarning(null)
            },
          },
        ]}
      />
    </>
  )

  if (twoPane) {
    return (
      <Screen padded={false}>
        <View style={styles.containerRow}>
          {gridPane}
          <View style={[styles.cartPane, { backgroundColor: theme.surface, borderLeftColor: theme.border }]}>
            <CartPanel
              onPay={() => navigation.navigate('Payment')}
              onHold={() => holdCart()}
              onDiscountPress={() => setDiscountOpen(true)}
            />
          </View>
        </View>
        {modals}
      </Screen>
    )
  }

  return (
    <Screen padded={false}>
      {gridPane}
      {/* Safe-area aware floating cart bar (used to clip under the gesture bar). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open cart, ${itemCount} items, total ${fmtUZS(total)}`}
        onPress={() => setCartOpen(true)}
        style={({ pressed }) => [
          styles.cartBar,
          { backgroundColor: theme.primary, bottom: Math.max(insets.bottom, spacing.md) },
          pressed && { opacity: opacity.pressed },
        ]}
      >
        <View style={styles.cartBarLeft}>
          <Icon name="cart" size={20} color={theme.onPrimary} />
          <Text style={[typeScale.md, { color: theme.onPrimary, fontWeight: '700' }]}>{itemCount} items</Text>
        </View>
        <Text style={[typeScale.moneyLg, { color: theme.onPrimary }]}>{fmtUZS(total)}</Text>
      </Pressable>
      <Sheet visible={cartOpen} onClose={() => setCartOpen(false)}>
        <CartPanel
          onPay={() => { setCartOpen(false); navigation.navigate('Payment') }}
          onHold={() => { holdCart(); setCartOpen(false) }}
          onDiscountPress={() => setDiscountOpen(true)}
        />
      </Sheet>
      {modals}
    </Screen>
  )
}

const styles = StyleSheet.create({
  containerRow: { flex: 1, flexDirection: 'row' },
  gridPane: { flex: 1, padding: spacing.md },
  searchRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'flex-start' },
  searchWrap: { flex: 1 },
  cartPane: { width: 360, borderLeftWidth: 1, padding: spacing.lg },
  cartBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 56,
  },
  cartBarLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
