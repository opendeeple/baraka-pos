import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Switch, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { CategoryItem, ProductListItem } from '@baraka/data'
import {
  BarcodeScannerModal,
  Badge,
  Button,
  Chip,
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
import { useTranslation } from '@baraka/mobile-i18n'
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
  categoryId: number | null
}

const EMPTY_FORM: FormState = {
  name: '', sku: '', barcode: '', price: '', cost: '', alertQuantity: '', isStockManaged: true, categoryId: null,
}

export function ProductsScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
  const { repos, engine } = getServices()
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<ProductListItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [categories, setCategories] = useState<CategoryItem[]>([])
  // 'lookup' (toolbar scan — find/open an existing product by its barcode,
  // or start a new one pre-filled with it) vs 'fill' (the form's own Barcode
  // field — scan a physical label straight into it instead of typing it).
  const [scanMode, setScanMode] = useState<'lookup' | 'fill' | null>(null)

  const load = useCallback(() => {
    setProducts(repos.products.list({ search: search || undefined, limit: 300 }))
    setCategories(repos.products.categories())
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
      categoryId: p.categoryId,
    })
    setShowForm(true)
  }

  function save() {
    if (!form.name.trim() || !form.price) {
      toast.error(t('products.nameAndPriceRequired'))
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
      categoryId: form.categoryId,
    }
    if (editId) repos.products.update(editId, input)
    else repos.products.create(input)
    engine.flushOutbox().catch(() => {})
    setShowForm(false)
    toast.success(editId ? t('products.updated') : t('products.created'))
    load()
  }

  const set = (k: keyof FormState, v: string | boolean) => setForm((prev) => ({ ...prev, [k]: v }))

  function handleScan(barcode: string) {
    const mode = scanMode
    setScanMode(null)
    if (mode === 'fill') {
      set('barcode', barcode)
      return
    }
    const existing = repos.products.findByBarcode(barcode)
    if (existing) {
      openEdit(existing)
    } else {
      setEditId(null)
      setForm({ ...EMPTY_FORM, barcode })
      setShowForm(true)
      toast.info(t('products.noBarcodeMatchYet'))
    }
  }

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder={t('products.searchPlaceholder')}
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <IconButton icon="scan" accessibilityLabel={t('products.scanBarcode')} onPress={() => setScanMode('lookup')} />
        <Button title={t('common.new')} icon="plus" size="md" onPress={openCreate} />
      </View>

      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={`${item.barcode ?? item.sku ?? '—'} · ${item.isStockManaged ? t('products.stock', { count: item.stock }) : t('products.unmanaged')}`}
            onPress={() => openEdit(item)}
            right={
              <View style={styles.rowRight}>
                {item.isStockManaged && item.alertQuantity > 0 && item.stock <= item.alertQuantity ? (
                  <Badge label={t('products.low')} tone="warning" />
                ) : null}
                <Text style={[typeScale.money, { color: theme.primary }]}>{fmtUZS(item.price)}</Text>
              </View>
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="package"
            title={search ? t('products.noneFound') : t('products.noneYet')}
            message={search ? t('common.tryDifferentSearch') : t('products.emptyHint')}
            action={search ? undefined : { label: t('products.newProduct'), onPress: openCreate }}
          />
        }
      />

      <Sheet visible={showForm} onClose={() => setShowForm(false)} title={editId ? t('products.editProduct') : t('products.newProduct')}>
        <View style={styles.form}>
          <Input label={t('common.name')} value={form.name} onChangeText={(v) => set('name', v)} />
          <View style={styles.row2}>
            <Input
              label={t('pos.priceLabel')}
              value={form.price}
              onChangeText={(v) => set('price', v)}
              keyboardType="numeric"
              containerStyle={styles.flex1}
            />
            <Input
              label={t('pos.costLabel')}
              value={form.cost}
              onChangeText={(v) => set('cost', v)}
              keyboardType="numeric"
              containerStyle={styles.flex1}
            />
          </View>
          <View style={styles.row2}>
            <Input
              label={t('pos.barcode')}
              value={form.barcode}
              onChangeText={(v) => set('barcode', v)}
              right={
                <IconButton
                  icon="scan"
                  size={20}
                  accessibilityLabel={t('products.scanBarcode')}
                  onPress={() => setScanMode('fill')}
                />
              }
              containerStyle={styles.flex1}
            />
            <Input label={t('products.sku')} value={form.sku} onChangeText={(v) => set('sku', v)} containerStyle={styles.flex1} />
          </View>
          <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('products.category')}</Text>
          <View style={styles.chipRow}>
            <Chip label={t('products.none')} selected={form.categoryId === null} onPress={() => setForm((p) => ({ ...p, categoryId: null }))} />
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={form.categoryId === c.id}
                onPress={() => setForm((p) => ({ ...p, categoryId: c.id }))}
              />
            ))}
          </View>
          <View style={styles.row2}>
            <Input
              label={t('products.lowStockAlertAt')}
              value={form.alertQuantity}
              onChangeText={(v) => set('alertQuantity', v)}
              keyboardType="numeric"
              helperText={t('products.lowStockAlertHint')}
              containerStyle={styles.flex1}
            />
            <View style={[styles.flex1, styles.switchCol]}>
              <Text style={[typeScale.sm, { color: theme.textMuted, fontWeight: '600' }]}>{t('products.trackStock')}</Text>
              <Switch
                value={form.isStockManaged}
                onValueChange={(v) => set('isStockManaged', v)}
                trackColor={{ true: theme.primary, false: theme.border }}
              />
            </View>
          </View>
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title={t('common.save')} onPress={save} style={styles.flex2} />
          </View>
        </View>
      </Sheet>

      <BarcodeScannerModal
        visible={scanMode !== null}
        onClose={() => setScanMode(null)}
        onScan={handleScan}
      />
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  switchCol: { alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
})
