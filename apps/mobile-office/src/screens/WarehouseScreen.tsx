import { useCallback, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { StocktakeRow, WarehouseStockRow, StockLocation, WriteOffReason } from '@baraka/data'
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
  const [stocktakeOpen, setStocktakeOpen] = useState(false)
  const [writeOffOpen, setWriteOffOpen] = useState(false)

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
      <View style={styles.actionRow}>
        <Button title="Stocktake" variant="secondary" size="sm" onPress={() => setStocktakeOpen(true)} style={styles.flex1} />
        <Button title="Write off" variant="secondary" size="sm" onPress={() => setWriteOffOpen(true)} style={styles.flex1} />
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

      {stocktakeOpen && (
        <StocktakeSheet
          onClose={() => setStocktakeOpen(false)}
          onDone={(changed) => {
            setStocktakeOpen(false)
            afterMutate()
            toast.success(`Stocktake saved — ${changed} product(s) adjusted`)
          }}
        />
      )}

      {writeOffOpen && (
        <WriteOffSheet
          products={rows}
          onClose={() => setWriteOffOpen(false)}
          onDone={(name, qty) => {
            setWriteOffOpen(false)
            afterMutate()
            toast.success(`Wrote off ${qty} × ${name}`)
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

function StocktakeSheet({ onClose, onDone }: { onClose: () => void; onDone: (changed: number) => void }) {
  const theme = useTheme()
  const { repos } = getServices()
  const { user } = useAuthStore()
  const [location, setLocation] = useState<StockLocation | null>(null)
  const [items, setItems] = useState<StocktakeRow[]>([])
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)

  function pickLocation(loc: StockLocation) {
    setLocation(loc)
    setItems(repos.warehouse.stocktakeItems(loc))
    setCounts({})
  }

  const diffOf = (r: StocktakeRow): number | null => {
    const c = counts[r.productId]
    return c === undefined || c.trim() === '' || !Number.isFinite(Number(c)) ? null : Number(c) - r.system
  }

  const visible = items.filter((r) => !search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()))
  const counted = items.filter((r) => diffOf(r) !== null)

  function finish() {
    if (!location) return
    const lines = counted.map((r) => ({
      productId: r.productId, batchId: r.batchId, name: r.name, system: r.system,
      counted: Number(counts[r.productId]), cost: r.cost,
    }))
    const result = repos.warehouse.applyStocktake(location, lines, note, user?.id ?? 1)
    onDone(result.changed)
  }

  return (
    <Sheet visible onClose={onClose} title="Stocktake">
      <View style={styles.form}>
        {!location ? (
          <>
            <Text style={[typeScale.sm, { color: theme.textMuted }]}>Count what's physically there — the system records the differences.</Text>
            <View style={styles.chipRow}>
              <Chip label="Shop" onPress={() => pickLocation('shop')} />
              <Chip label="Warehouse" onPress={() => pickLocation('warehouse')} />
            </View>
          </>
        ) : confirming ? (
          <>
            <Text style={[typeScale.sm, { color: theme.text }]}>
              {counted.length} product(s) will be adjusted. Continue?
            </Text>
            <View style={styles.actions}>
              <Button title="Back" variant="secondary" onPress={() => setConfirming(false)} style={styles.flex1} />
              <Button title="Finish" onPress={finish} style={styles.flex2} />
            </View>
          </>
        ) : (
          <>
            <Input value={search} onChangeText={setSearch} placeholder="Search products…" left={<Icon name="search" size={16} color={theme.textFaint} />} />
            <Text style={[typeScale.xs, { color: theme.textFaint }]}>{counted.length} of {items.length} counted</Text>
            <ScrollView style={styles.stocktakeList} contentContainerStyle={styles.stocktakeListInner} keyboardShouldPersistTaps="handled">
              {visible.map((r) => {
                const d = diffOf(r)
                return (
                  <View key={r.productId} style={[styles.rowItem, { borderColor: theme.border }]}>
                    <View style={styles.flex1}>
                      <Text style={[typeScale.sm, { color: theme.text }]} numberOfLines={1}>{r.name}</Text>
                      <Text style={[typeScale.xs, { color: theme.textFaint }]}>System: {r.system}</Text>
                    </View>
                    <Input
                      value={counts[r.productId] ?? ''}
                      onChangeText={(v) => setCounts((p) => ({ ...p, [r.productId]: v }))}
                      keyboardType="decimal-pad"
                      containerStyle={styles.qtyInput}
                    />
                    <Text style={[typeScale.sm, { width: 44, textAlign: 'right' }, { color: d === null ? theme.textFaint : d < 0 ? theme.danger : d > 0 ? theme.success : theme.textMuted }]}>
                      {d === null ? '—' : d > 0 ? `+${d}` : d}
                    </Text>
                  </View>
                )
              })}
            </ScrollView>
            <Input label="Note (optional)" value={note} onChangeText={setNote} />
            <View style={styles.actions}>
              <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex1} />
              <Button title="Finish" disabled={counted.length === 0} onPress={() => setConfirming(true)} style={styles.flex2} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  )
}

const WRITEOFF_REASONS: WriteOffReason[] = ['damaged', 'expired', 'lost', 'internal', 'other']

function WriteOffSheet({
  products, onClose, onDone,
}: {
  products: WarehouseStockRow[]
  onClose: () => void
  onDone: (productName: string, qty: number) => void
}) {
  const theme = useTheme()
  const { repos } = getServices()
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<WarehouseStockRow | null>(null)
  const [location, setLocation] = useState<StockLocation>('shop')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<WriteOffReason | null>(null)
  const [note, setNote] = useState('')

  const matches = (search.trim() ? products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())) : products).slice(0, 60)
  const available = picked ? (location === 'shop' ? picked.shopQty : picked.warehouseQty) : 0
  const n = Number(qty)
  const qtyValid = qty.trim() !== '' && Number.isFinite(n) && n > 0 && n <= available
  const valid = picked && qtyValid && reason && (reason !== 'other' || note.trim())

  function save() {
    if (!picked?.batchId || !valid || !reason) return
    repos.warehouse.writeOff({
      productId: picked.id, batchId: picked.batchId, productName: picked.name,
      location, qty: n, cost: picked.cost, reason, note, userId: user?.id ?? 1,
    })
    onDone(picked.name, n)
  }

  return (
    <Sheet visible onClose={onClose} title="Write off">
      <View style={styles.form}>
        {!picked ? (
          <>
            <Input value={search} onChangeText={setSearch} placeholder="Search products…" left={<Icon name="search" size={16} color={theme.textFaint} />} autoFocus />
            <ScrollView style={styles.stocktakeList} contentContainerStyle={styles.stocktakeListInner} keyboardShouldPersistTaps="handled">
              {matches.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={`Shop ${p.shopQty} · Warehouse ${p.warehouseQty}`}
                  onPress={() => setPicked(p)}
                />
              ))}
            </ScrollView>
          </>
        ) : (
          <>
            <Text style={[typeScale.md, { color: theme.text, fontWeight: '700' }]}>{picked.name}</Text>
            <View style={styles.chipRow}>
              <Chip label={`Shop (${picked.shopQty})`} selected={location === 'shop'} onPress={() => setLocation('shop')} />
              <Chip label={`Warehouse (${picked.warehouseQty})`} selected={location === 'warehouse'} onPress={() => setLocation('warehouse')} />
            </View>
            <Input
              label={`Quantity (max ${available})`}
              value={qty}
              onChangeText={setQty}
              keyboardType="decimal-pad"
              error={qty.trim() !== '' && !qtyValid ? `Only ${available} available` : null}
            />
            <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Reason</Text>
            <View style={styles.chipRow}>
              {WRITEOFF_REASONS.map((r) => (
                <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />
              ))}
            </View>
            <Input
              label={reason === 'other' ? 'Note (required)' : 'Note (optional)'}
              value={note}
              onChangeText={setNote}
            />
            <View style={styles.actions}>
              <Button title="Back" variant="secondary" onPress={() => setPicked(null)} style={styles.flex1} />
              <Button title="Save" disabled={!valid} onPress={save} style={styles.flex2} />
            </View>
          </>
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
  totalCard: { flex: 1 },
  toolbar: { padding: spacing.md },
  actionRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  stocktakeList: { maxHeight: 360 },
  stocktakeListInner: { gap: spacing.xs },
  rowItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: 8, padding: spacing.sm,
  },
  qtyInput: { width: 70 },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
