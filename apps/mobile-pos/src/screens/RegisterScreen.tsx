import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
  useWindowDimensions, View,
} from 'react-native'
import { NumPad, applyNumKey } from '../components/NumPad'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { fmtUZS } from '@baraka/app-core'
import { PULL_TABLE_ORDER } from '@baraka/sync-engine'
import type { ProductListItem, CategoryItem } from '@baraka/data'
import { getServices } from '../platform/services'
import { BarcodeScannerModal } from '../components/BarcodeScannerModal'
import { colors } from '../theme'
import type { RootStackParamList } from '../navigation'

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>

export function RegisterScreen({ navigation }: Props) {
  const { repos, useCartStore, engine } = getServices()
  const { width } = useWindowDimensions()
  const twoPane = width >= 768

  const [products, setProducts] = useState<ProductListItem[]>([])
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [discountEntry, setDiscountEntry] = useState('')

  const cart = useCartStore()

  const load = useCallback(() => {
    setProducts(repos.products.list({ search: search || undefined, categoryId: categoryId ?? undefined }))
  }, [search, categoryId])

  useEffect(() => {
    setCategories(repos.products.categories())
    cart.loadHeldCarts()
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

  const total = cart.getFinalTotal()
  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0)

  function addProduct(p: ProductListItem) {
    if (!p.batchId) return
    const doAdd = () =>
      cart.addItem({
        productId: p.id,
        batchId: p.batchId,
        name: p.name,
        quantity: 1,
        unitPrice: p.price,
        unitCost: p.cost,
        discount: 0,
      } as never)
    // Stock is advisory, not blocking (Odoo/OSPOS stance): the shelf is the
    // source of truth in a mini-market — warn on oversell, let the cashier
    // decide, and let the sync-side clamp keep the numbers sane.
    if (p.isStockManaged) {
      const inCart = cart.items
        .filter((i) => i.productId === p.id && i.batchId === p.batchId)
        .reduce((s, i) => s + i.quantity, 0)
      if (inCart + 1 > p.stock) {
        Alert.alert(
          'Stock warning',
          `${p.name}: system shows ${p.stock} in stock${inCart ? ` (${inCart} already in cart)` : ''}. Sell anyway?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sell anyway', onPress: doAdd },
          ]
        )
        return
      }
    }
    doAdd()
  }

  const grid = (
    <View style={styles.gridPane}>
      <View style={styles.searchRow}>
        <TextInput
          style={[styles.search, { flex: 1, marginBottom: 0 }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search or scan barcode…"
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={() => {
            const hit = repos.products.findByBarcode(search.trim())
            if (hit) {
              addProduct(hit)
              setSearch('')
            }
          }}
        />
        <TouchableOpacity style={styles.scanBtn} onPress={() => setScannerOpen(true)}>
          <Text style={styles.scanBtnText}>▣ Scan</Text>
        </TouchableOpacity>
      </View>
      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(code) => {
          const hit = repos.products.findByBarcode(code)
          if (hit) addProduct(hit)
        }}
      />
      <Modal visible={discountOpen} animationType="fade" transparent onRequestClose={() => setDiscountOpen(false)}>
        <View style={styles.discountOverlay}>
          <View style={styles.discountSheet}>
            <Text style={styles.cartTitle}>Sale discount</Text>
            <Text style={styles.discountEntry}>{discountEntry ? fmtUZS(Number(discountEntry)) : '0.00'}</Text>
            <NumPad onKey={(k) => setDiscountEntry((v) => applyNumKey(v, k))} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.holdBtn]}
                onPress={() => { cart.setDiscount(0); setDiscountOpen(false) }}
              >
                <Text style={styles.actionBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.payBtn]}
                onPress={() => {
                  const value = Number(discountEntry) || 0
                  const subtotal = cart.getSubtotal() + cart.getTotalChargeAmount()
                  if (value > subtotal) {
                    Alert.alert('Too large', 'Discount cannot exceed the sale total')
                    return
                  }
                  cart.setDiscount(value)
                  setDiscountOpen(false)
                }}
              >
                <Text style={styles.actionBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ gap: 8 }}>
        <Chip label="All" active={categoryId === null} onPress={() => setCategoryId(null)} />
        {categories.map((c) => (
          <Chip key={c.id} label={c.name} active={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
        ))}
      </ScrollView>
      <FlatList
        data={products}
        numColumns={twoPane ? 4 : 2}
        key={twoPane ? 'wide' : 'narrow'}
        keyExtractor={(p) => String(p.id)}
        columnWrapperStyle={{ gap: 8 }}
        contentContainerStyle={{ gap: 8, paddingBottom: 90 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.productCard} activeOpacity={0.7} onPress={() => addProduct(item)}>
            <Text style={styles.productName} numberOfLines={2}>
              {item.isFeatured ? '★ ' : ''}{item.name}
            </Text>
            <Text style={styles.productPrice}>{fmtUZS(item.price)}</Text>
            <Text
              style={[
                styles.productStock,
                item.stock <= 0 && { color: colors.danger },
                item.stock > 0 && item.alertQuantity > 0 && item.stock <= item.alertQuantity && { color: '#f59e0b' },
              ]}
            >
              {item.isStockManaged
                ? item.stock > 0 && item.alertQuantity > 0 && item.stock <= item.alertQuantity
                  ? `⚠ Low: ${item.stock}`
                  : `Stock: ${item.stock}`
                : '∞'}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )

  const cartPanel = (
    <View style={twoPane ? styles.cartPane : styles.cartModalBody}>
      <Text style={styles.cartTitle}>Cart ({itemCount})</Text>
      <FlatList
        data={cart.items}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ gap: 6 }}
        renderItem={({ item, index }) => (
          <View style={styles.cartRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cartItemName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.cartItemPrice}>{fmtUZS(item.unitPrice)} each</Text>
            </View>
            <View style={styles.qtyControls}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => cart.setQuantity(index, item.quantity - 1)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyText}>{item.quantity}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => cart.setQuantity(index, item.quantity + 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyCart}>Tap products to add them</Text>}
      />
      <View style={styles.cartFooter}>
        <TouchableOpacity
          style={styles.discountRow}
          onPress={() => { setDiscountEntry(cart.discount ? String(cart.discount) : ''); setDiscountOpen(true) }}
        >
          <Text style={styles.discountLabel}>Discount</Text>
          <Text style={[styles.discountValue, cart.discount > 0 && { color: colors.primary }]}>
            {cart.discount > 0 ? `−${fmtUZS(cart.discount)}` : 'add ›'}
          </Text>
        </TouchableOpacity>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{fmtUZS(total)}</Text>
        </View>
        {cart.heldCarts.length > 0 && (
          <TouchableOpacity
            style={styles.heldBtn}
            onPress={() => {
              const latest = cart.heldCarts[cart.heldCarts.length - 1]
              cart.restoreHeld(latest.id)
            }}
          >
            <Text style={styles.heldBtnText}>
              ⏸ {cart.heldCarts.length} held — tap to restore latest
            </Text>
          </TouchableOpacity>
        )}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.holdBtn]}
            onPress={() => { cart.holdCart(); setCartOpen(false) }}
            disabled={cart.items.length === 0}
          >
            <Text style={styles.actionBtnText}>Hold</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.payBtn]}
            disabled={cart.items.length === 0}
            onPress={() => { setCartOpen(false); navigation.navigate('Payment') }}
          >
            <Text style={styles.actionBtnText}>Pay {fmtUZS(total)}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )

  if (twoPane) {
    return (
      <View style={styles.containerRow}>
        {grid}
        {cartPanel}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {grid}
      <TouchableOpacity style={styles.cartBar} onPress={() => setCartOpen(true)}>
        <Text style={styles.cartBarText}>🛒 {itemCount} items</Text>
        <Text style={styles.cartBarTotal}>{fmtUZS(total)}</Text>
      </TouchableOpacity>
      <Modal visible={cartOpen} animationType="slide" transparent onRequestClose={() => setCartOpen(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setCartOpen(false)} />
          <View style={styles.cartModal}>{cartPanel}</View>
        </View>
      </Modal>
    </View>
  )
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  containerRow: { flex: 1, backgroundColor: colors.bg, flexDirection: 'row' },
  gridPane: { flex: 1, padding: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  search: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, color: colors.text, marginBottom: 10,
  },
  scanBtn: {
    backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  scanBtnText: { color: '#fff', fontWeight: '700' },
  chips: { flexGrow: 0, marginBottom: 10 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  productCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 12, minHeight: 92,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between',
  },
  productName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  productPrice: { color: colors.primary, fontSize: 14, fontWeight: '700', marginTop: 6 },
  productStock: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  cartPane: {
    width: 340, backgroundColor: colors.surface, borderLeftWidth: 1, borderLeftColor: colors.border, padding: 14,
  },
  cartTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  cartRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 10, padding: 10, gap: 8,
  },
  cartItemName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  cartItemPrice: { color: colors.textMuted, fontSize: 11 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 34, height: 34, borderRadius: 8, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  qtyText: { color: colors.text, fontSize: 15, fontWeight: '700', minWidth: 22, textAlign: 'center' },
  emptyCart: { color: colors.textMuted, textAlign: 'center', marginTop: 30 },
  cartFooter: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 8 },
  discountRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  discountLabel: { color: colors.textMuted, fontSize: 13 },
  discountValue: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  discountOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  discountSheet: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 18, width: '100%', maxWidth: 380,
  },
  discountEntry: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center', marginVertical: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  totalLabel: { color: colors.textMuted, fontSize: 15 },
  totalValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  actionBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  heldBtn: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: 10,
    paddingVertical: 9, alignItems: 'center', marginBottom: 8,
  },
  heldBtnText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  holdBtn: { backgroundColor: colors.border },
  payBtn: { backgroundColor: colors.primary, flex: 2 },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cartBar: {
    position: 'absolute', left: 12, right: 12, bottom: 16, backgroundColor: colors.primary,
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  cartBarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cartBarTotal: { color: '#fff', fontSize: 16, fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  cartModal: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '75%', padding: 14,
  },
  cartModalBody: { flexGrow: 1 },
})
