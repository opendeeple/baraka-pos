import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { WarehouseStockRow, StockLocation } from '@baraka/data'
import {
  Button,
  Chip,
  Dialog,
  EmptyState,
  Icon,
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

export function WarehouseScreen() {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<WarehouseStockRow[]>([])
  const [actionsFor, setActionsFor] = useState<WarehouseStockRow | null>(null)
  const [receiveFor, setReceiveFor] = useState<WarehouseStockRow | null>(null)
  const [transferFor, setTransferFor] = useState<WarehouseStockRow | null>(null)

  const load = useCallback(() => {
    setRows(repos.warehouse.list({ search: search || undefined }))
  }, [search])

  useFocusEffect(load)

  const totals = rows.reduce(
    (acc, r) => ({ shop: acc.shop + r.shopQty, warehouse: acc.warehouse + r.warehouseQty }),
    { shop: 0, warehouse: 0 }
  )

  function afterMutate() {
    engine.flushOutbox().catch(() => {})
    load()
  }

  return (
    <Screen padded={false}>
      <View style={styles.totals}>
        <View style={styles.totalCard}>
          <Text style={[typeScale.sm, { color: theme.textMuted }]}>In shop</Text>
          <Text style={[typeScale.lg, { color: theme.text, fontWeight: '700' }]}>{totals.shop}</Text>
        </View>
        <View style={styles.totalCard}>
          <Text style={[typeScale.sm, { color: theme.textMuted }]}>In warehouse</Text>
          <Text style={[typeScale.lg, { color: theme.text, fontWeight: '700' }]}>{totals.warehouse}</Text>
        </View>
      </View>

      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder="Search products…"
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`Shop ${item.shopQty} · Warehouse ${item.warehouseQty}`}
            onPress={() => setActionsFor(item)}
            right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          />
        )}
        ListEmptyComponent={<EmptyState icon="warehouse" title="No stock-managed products found" />}
      />

      <Dialog
        visible={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        title={actionsFor?.name ?? ''}
        message={actionsFor ? `Shop ${actionsFor.shopQty} · Warehouse ${actionsFor.warehouseQty}` : ''}
        actions={[
          { label: 'Cancel', onPress: () => setActionsFor(null) },
          ...(actionsFor && actionsFor.warehouseQty > 0
            ? [{ label: 'Transfer to shop', onPress: () => { setTransferFor(actionsFor); setActionsFor(null) } }]
            : []),
          { label: 'Receive', tone: 'primary' as const, onPress: () => { setReceiveFor(actionsFor); setActionsFor(null) } },
        ]}
      />

      {receiveFor && (
        <ReceiveSheet
          product={receiveFor}
          onClose={() => setReceiveFor(null)}
          onConfirm={(qty, location, reason, unitCost) => {
            if (!receiveFor.batchId) return
            repos.warehouse.receive({
              productId: receiveFor.id, batchId: receiveFor.batchId, qty, location, reason,
              userId: user?.id ?? 1, unitCost,
            })
            setReceiveFor(null)
            afterMutate()
            toast.success(`Received into ${location === 'shop' ? 'the shop' : 'the warehouse'}`)
          }}
        />
      )}

      {transferFor && (
        <TransferSheet
          product={transferFor}
          onClose={() => setTransferFor(null)}
          onConfirm={(qty) => {
            if (!transferFor.batchId) return
            try {
              repos.warehouse.transferToShop({ productId: transferFor.id, batchId: transferFor.batchId, qty, userId: user?.id ?? 1 })
              setTransferFor(null)
              afterMutate()
              toast.success('Transferred to the shop')
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Transfer failed')
            }
          }}
        />
      )}
    </Screen>
  )
}

function ReceiveSheet({
  product, onClose, onConfirm,
}: {
  product: WarehouseStockRow
  onClose: () => void
  onConfirm: (qty: number, location: StockLocation, reason: string, unitCost?: number) => void
}) {
  const theme = useTheme()
  const [qty, setQty] = useState('')
  const [location, setLocation] = useState<StockLocation>('shop')
  const [cost, setCost] = useState(product.cost ? String(product.cost) : '')
  const [reason, setReason] = useState('')

  function confirm() {
    const n = Number(qty)
    if (!n || n <= 0 || !product.batchId) {
      toast.error('Enter a quantity')
      return
    }
    const costNum = cost.trim() === '' ? undefined : Number(cost)
    onConfirm(n, location, reason, costNum)
  }

  return (
    <Sheet visible onClose={onClose} title={`Receive — ${product.name}`}>
      <View style={styles.form}>
        <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Where to</Text>
        <View style={styles.chipRow}>
          <Chip label="Shop" selected={location === 'shop'} onPress={() => setLocation('shop')} />
          <Chip label="Warehouse" selected={location === 'warehouse'} onPress={() => setLocation('warehouse')} />
        </View>
        <Input label="Quantity" value={qty} onChangeText={setQty} keyboardType="numeric" autoFocus />
        <Input label="Unit cost (optional)" value={cost} onChangeText={setCost} keyboardType="numeric" />
        <Input label="Reason (optional)" value={reason} onChangeText={setReason} />
        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button title="Save" onPress={confirm} style={styles.flex2} />
        </View>
      </View>
    </Sheet>
  )
}

function TransferSheet({
  product, onClose, onConfirm,
}: {
  product: WarehouseStockRow
  onClose: () => void
  onConfirm: (qty: number) => void
}) {
  const theme = useTheme()
  const [qty, setQty] = useState('')

  function confirm() {
    const n = Number(qty)
    if (!n || n <= 0) {
      toast.error('Enter a quantity')
      return
    }
    if (n > product.warehouseQty) {
      toast.error(`Only ${product.warehouseQty} available in the warehouse`)
      return
    }
    onConfirm(n)
  }

  return (
    <Sheet visible onClose={onClose} title={`Transfer to shop — ${product.name}`}>
      <View style={styles.form}>
        <Text style={[typeScale.sm, { color: theme.textMuted }]}>{product.warehouseQty} available in the warehouse</Text>
        <Input label="Quantity" value={qty} onChangeText={setQty} keyboardType="numeric" autoFocus />
        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button title="Transfer" onPress={confirm} style={styles.flex2} />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
  totalCard: { flex: 1 },
  toolbar: { padding: spacing.md },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
