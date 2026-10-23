import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { OrderLineInput, ProductListItem, PurchaseItemRow, PurchaseListItem, StockLocation } from '@baraka/data'
import {
  Badge,
  Button,
  Chip,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Input,
  ListRow,
  Screen,
  Sheet,
  toast,
  useTheme,
} from '@baraka/mobile-ui'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'

interface CartLine {
  productId: number
  batchId: number
  name: string
  qty: number
  unitCost: number
}

export function PurchasesScreen() {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const { user, store } = useAuthStore()
  const [orders, setOrders] = useState<PurchaseListItem[]>([])
  const [newOrderOpen, setNewOrderOpen] = useState(false)
  const [receiveTarget, setReceiveTarget] = useState<PurchaseListItem | null>(null)
  const [viewTarget, setViewTarget] = useState<PurchaseListItem | null>(null)

  const load = useCallback(() => {
    setOrders(repos.purchases.list(100))
  }, [])

  useFocusEffect(load)

  function afterMutate() {
    engine.flushOutbox().catch(() => {})
    load()
  }

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Button title="New order" icon="plus" onPress={() => setNewOrderOpen(true)} fullWidth />
      </View>

      <FlatList
        data={orders}
        keyExtractor={(o) => String(o.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ListRow
            title={item.referenceNumber ?? `#${item.id}`}
            subtitle={`${item.vendorName ?? 'No supplier'} · ${String(item.createdAt).slice(0, 16).replace('T', ' ')}`}
            onPress={() => (item.status === 'pending' ? setReceiveTarget(item) : setViewTarget(item))}
            right={
              <View style={styles.rowRight}>
                <Text style={[typeScale.money, { color: theme.text }]}>{fmtUZS(item.totalAmount)}</Text>
                <Badge
                  label={item.status === 'received' ? 'Received' : 'Pending'}
                  tone={item.status === 'received' ? 'success' : 'warning'}
                />
              </View>
            }
          />
        )}
        ListEmptyComponent={<EmptyState icon="truck" title="No purchase orders yet" message="Order goods from a supplier to track what's on the way" />}
      />

      {newOrderOpen && (
        <NewOrderSheet
          onClose={() => setNewOrderOpen(false)}
          onCreate={(lines) => {
            repos.purchases.create(lines, { storeId: store?.id ?? 1, userId: user?.id ?? 1 })
            setNewOrderOpen(false)
            afterMutate()
            toast.success('Order created')
          }}
        />
      )}

      {receiveTarget && (
        <ReceiveOrderSheet
          order={receiveTarget}
          onClose={() => setReceiveTarget(null)}
          onReceived={(location, checks) => {
            try {
              repos.purchases.receive(receiveTarget.id, location, checks, user?.id ?? 1)
              setReceiveTarget(null)
              afterMutate()
              toast.success('Order received')
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Receive failed')
            }
          }}
        />
      )}

      {viewTarget && (
        <OrderDetailSheet order={viewTarget} onClose={() => setViewTarget(null)} />
      )}
    </Screen>
  )
}

function NewOrderSheet({ onClose, onCreate }: { onClose: () => void; onCreate: (lines: OrderLineInput[]) => void }) {
  const theme = useTheme()
  const { repos } = getServices()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ProductListItem[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [qtyTarget, setQtyTarget] = useState<ProductListItem | null>(null)

  function runSearch(v: string) {
    setSearch(v)
    setResults(v.trim() ? repos.products.list({ search: v, limit: 20 }) : [])
  }

  const total = cart.reduce((s, l) => s + l.qty * l.unitCost, 0)

  return (
    <Sheet visible onClose={onClose} title="New order">
      <Input
        value={search}
        onChangeText={runSearch}
        placeholder="Search products to add…"
        left={<Icon name="search" size={16} color={theme.textFaint} />}
        returnKeyType="search"
      />
      {results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(p) => String(p.id)}
          style={styles.searchResults}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ListRow
              title={item.name}
              subtitle={`Cost ${fmtUZS(item.cost)} · Stock ${item.stock}`}
              onPress={() => item.batchId && setQtyTarget(item)}
            />
          )}
        />
      )}

      <View style={styles.cartSection}>
        <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Order lines</Text>
        {cart.length === 0 ? (
          <Text style={[typeScale.sm, { color: theme.textFaint }]}>Search above and tap a product to add it</Text>
        ) : (
          cart.map((l) => (
            <View key={l.productId} style={[styles.cartRow, { borderColor: theme.border }]}>
              <View style={styles.flex1}>
                <Text style={[typeScale.sm, { color: theme.text }]}>{l.name}</Text>
                <Text style={[typeScale.sm, { color: theme.textMuted }]}>{l.qty} × {fmtUZS(l.unitCost)}</Text>
              </View>
              <IconButton
                icon="x"
                size={20}
                color={theme.danger}
                accessibilityLabel={`Remove ${l.name}`}
                onPress={() => setCart((prev) => prev.filter((c) => c.productId !== l.productId))}
              />
            </View>
          ))
        )}
      </View>

      <View style={styles.actions}>
        <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex1} />
        <Button
          title={`Create order (${fmtUZS(total)})`}
          disabled={cart.length === 0}
          onPress={() => onCreate(cart.map((l) => ({ productId: l.productId, batchId: l.batchId, qty: l.qty, unitCost: l.unitCost })))}
          style={styles.flex2}
        />
      </View>

      {qtyTarget && (
        <QtyCostDialog
          product={qtyTarget}
          onClose={() => setQtyTarget(null)}
          onConfirm={(qty, unitCost) => {
            const batchId = qtyTarget.batchId
            if (!batchId) return
            setCart((prev) => [
              ...prev.filter((l) => l.productId !== qtyTarget.id),
              { productId: qtyTarget.id, batchId, name: qtyTarget.name, qty, unitCost },
            ])
            setQtyTarget(null)
            setSearch('')
            setResults([])
          }}
        />
      )}
    </Sheet>
  )
}

function QtyCostDialog({
  product, onClose, onConfirm,
}: {
  product: ProductListItem
  onClose: () => void
  onConfirm: (qty: number, unitCost: number) => void
}) {
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(String(product.cost || ''))

  return (
    <Dialog
      visible
      onClose={onClose}
      title={product.name}
      actions={[
        { label: 'Cancel', onPress: onClose },
        {
          label: 'Add',
          tone: 'primary',
          onPress: () => {
            const n = Number(qty)
            if (!n || n <= 0) {
              toast.error('Enter a quantity')
              return
            }
            onConfirm(n, Number(cost) || 0)
          },
        },
      ]}
    >
      <Input label="Quantity" value={qty} onChangeText={setQty} keyboardType="numeric" autoFocus containerStyle={styles.gapTop} />
      <Input label="Unit cost" value={cost} onChangeText={setCost} keyboardType="numeric" containerStyle={styles.gapTop} />
    </Dialog>
  )
}

function ReceiveOrderSheet({
  order, onClose, onReceived,
}: {
  order: PurchaseListItem
  onClose: () => void
  onReceived: (location: StockLocation, checks: Array<{ itemId: number; receivedQty: number; unitCost?: number }>) => void
}) {
  const theme = useTheme()
  const { repos } = getServices()
  const [items] = useState<PurchaseItemRow[]>(() => repos.purchases.items(order.id))
  const [location, setLocation] = useState<StockLocation>('shop')
  const [qtys, setQtys] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, String(i.quantity)]))
  )

  return (
    <Sheet visible onClose={onClose} title={`Receive — ${order.referenceNumber ?? order.id}`}>
      <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Receive into</Text>
      <View style={styles.chipRow}>
        <Chip label="Shop" selected={location === 'shop'} onPress={() => setLocation('shop')} />
        <Chip label="Warehouse" selected={location === 'warehouse'} onPress={() => setLocation('warehouse')} />
      </View>

      <View style={styles.cartSection}>
        {items.map((item) => (
          <View key={item.id} style={[styles.cartRow, { borderColor: theme.border }]}>
            <View style={styles.flex1}>
              <Text style={[typeScale.sm, { color: theme.text }]}>{item.productName}</Text>
              <Text style={[typeScale.sm, { color: theme.textMuted }]}>Ordered {item.quantity}</Text>
            </View>
            <Input
              value={qtys[item.id] ?? ''}
              onChangeText={(v) => setQtys((prev) => ({ ...prev, [item.id]: v }))}
              keyboardType="numeric"
              containerStyle={styles.qtyInput}
            />
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex1} />
        <Button
          title="Mark received"
          onPress={() =>
            onReceived(
              location,
              items.map((item) => ({ itemId: item.id, receivedQty: Number(qtys[item.id]) || 0 }))
            )
          }
          style={styles.flex2}
        />
      </View>
    </Sheet>
  )
}

function OrderDetailSheet({ order, onClose }: { order: PurchaseListItem; onClose: () => void }) {
  const theme = useTheme()
  const { repos } = getServices()
  const [items] = useState<PurchaseItemRow[]>(() => repos.purchases.items(order.id))

  return (
    <Sheet visible onClose={onClose} title={order.referenceNumber ?? `#${order.id}`}>
      <View style={styles.cartSection}>
        {items.map((item) => (
          <View key={item.id} style={[styles.cartRow, { borderColor: theme.border }]}>
            <Text style={[typeScale.sm, { color: theme.text }]}>{item.productName}</Text>
            <Text style={[typeScale.sm, { color: theme.textMuted }]}>{item.quantity} × {fmtUZS(item.unitCost)}</Text>
          </View>
        ))}
      </View>
      <Button title="Close" variant="secondary" onPress={onClose} style={styles.gapTop} />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  toolbar: { padding: spacing.md },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  searchResults: { maxHeight: 220, marginTop: spacing.sm },
  cartSection: { gap: spacing.sm, marginTop: spacing.md },
  cartRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: 8, padding: spacing.sm,
  },
  qtyInput: { width: 80 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  chipRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  gapTop: { marginTop: spacing.sm },
})
