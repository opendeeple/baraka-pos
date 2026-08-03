import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Switch, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { ProductListItem } from '@baraka/data'
import {
  Badge,
  Button,
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

interface FormState {
  name: string
  sku: string
  barcode: string
  price: string
  cost: string
  alertQuantity: string
  isStockManaged: boolean
}

const EMPTY_FORM: FormState = {
  name: '', sku: '', barcode: '', price: '', cost: '', alertQuantity: '', isStockManaged: true,
}

export function ProductsScreen() {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<ProductListItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const load = useCallback(() => {
    setProducts(repos.products.list({ search: search || undefined, limit: 300 }))
  }, [search])

  useFocusEffect(load)

  function openCreate() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(p: ProductListItem) {
    setEditId(p.id)
    setForm({
      name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '',
      price: String(p.price), cost: String(p.cost),
      // Pre-refactor this was hardcoded '' — every edit silently wiped the
      // low-stock threshold back to 0.
      alertQuantity: p.alertQuantity ? String(p.alertQuantity) : '',
      isStockManaged: p.isStockManaged,
    })
    setShowForm(true)
  }

  function save() {
    if (!form.name.trim() || !form.price) {
      toast.error('Name and price are required')
      return
    }
    const input = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      price: Number(form.price) || 0,
      cost: Number(form.cost) || 0,
      alertQuantity: Number(form.alertQuantity) || 0,
      isStockManaged: form.isStockManaged,
    }
    if (editId) repos.products.update(editId, input)
    else repos.products.create(input)
    engine.flushOutbox().catch(() => {})
    setShowForm(false)
    toast.success(editId ? 'Product updated' : 'Product created')
    load()
  }

  const set = (k: keyof FormState, v: string | boolean) => setForm((prev) => ({ ...prev, [k]: v }))

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder="Search products…"
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title="New" icon="plus" size="md" onPress={openCreate} />
      </View>

      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${item.barcode ?? item.sku ?? '—'} · ${item.isStockManaged ? `stock ${item.stock}` : 'unmanaged'}`}
            onPress={() => openEdit(item)}
            right={
              <View style={styles.rowRight}>
                {item.isStockManaged && item.alertQuantity > 0 && item.stock <= item.alertQuantity ? (
                  <Badge label="Low" tone="warning" />
                ) : null}
                <Text style={[typeScale.money, { color: theme.primary }]}>{fmtUZS(item.price)}</Text>
              </View>
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="package"
            title={search ? 'No products found' : 'No products yet'}
            message={search ? 'Try a different search' : 'Create your first product to start selling'}
            action={search ? undefined : { label: 'New product', onPress: openCreate }}
          />
        }
      />

      <Sheet visible={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit product' : 'New product'}>
        <View style={styles.form}>
          <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} />
          <View style={styles.row2}>
            <Input
              label="Price"
              value={form.price}
              onChangeText={(v) => set('price', v)}
              keyboardType="numeric"
              containerStyle={styles.flex1}
            />
            <Input
              label="Cost"
              value={form.cost}
              onChangeText={(v) => set('cost', v)}
              keyboardType="numeric"
              containerStyle={styles.flex1}
            />
          </View>
          <View style={styles.row2}>
            <Input
              label="Barcode"
              value={form.barcode}
              onChangeText={(v) => set('barcode', v)}
              containerStyle={styles.flex1}
            />
            <Input label="SKU" value={form.sku} onChangeText={(v) => set('sku', v)} containerStyle={styles.flex1} />
          </View>
          <View style={styles.row2}>
            <Input
              label="Low-stock alert at"
              value={form.alertQuantity}
              onChangeText={(v) => set('alertQuantity', v)}
              keyboardType="numeric"
              helperText="0 disables the low-stock warning"
              containerStyle={styles.flex1}
            />
            <View style={[styles.flex1, styles.switchCol]}>
              <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>Track stock</Text>
              <Switch
                value={form.isStockManaged}
                onValueChange={(v) => set('isStockManaged', v)}
                trackColor={{ true: theme.primary, false: theme.border }}
              />
            </View>
          </View>
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title="Save" onPress={save} style={styles.flex2} />
          </View>
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0, alignItems: 'flex-start' },
  searchWrap: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  row2: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  switchCol: { alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
})
