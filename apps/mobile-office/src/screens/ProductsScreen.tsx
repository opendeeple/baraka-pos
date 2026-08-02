import { useCallback, useState } from 'react'
import {
  FlatList, Modal, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { ProductListItem } from '@baraka/data'
import { getServices } from '../platform/services'
import { colors } from '../theme'

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
      alertQuantity: '', isStockManaged: p.isStockManaged,
    })
    setShowForm(true)
  }

  function save() {
    if (!form.name.trim() || !form.price) return
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
    load()
  }

  const set = (k: keyof FormState, v: string | boolean) => setForm((prev) => ({ ...prev, [k]: v }))

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder="Search products…"
          placeholderTextColor={colors.textMuted}
        />
        <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
          <Text style={styles.addBtnText}>＋ New</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => openEdit(item)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.meta}>
                {item.barcode ?? item.sku ?? '—'} · {item.isStockManaged ? `stock ${item.stock}` : 'unmanaged'}
              </Text>
            </View>
            <Text style={styles.price}>{fmtUZS(item.price)}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No products</Text>}
      />

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editId ? 'Edit product' : 'New product'}</Text>
            <Field label="Name" value={form.name} onChange={(v) => set('name', v)} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Field label="Price" value={form.price} onChange={(v) => set('price', v)} numeric flex />
              <Field label="Cost" value={form.cost} onChange={(v) => set('cost', v)} numeric flex />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Field label="Barcode" value={form.barcode} onChange={(v) => set('barcode', v)} flex />
              <Field label="SKU" value={form.sku} onChange={(v) => set('sku', v)} flex />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Track stock</Text>
              <Switch
                value={form.isStockManaged}
                onValueChange={(v) => set('isStockManaged', v)}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: colors.border }]} onPress={() => setShowForm(false)}>
                <Text style={styles.sheetBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: colors.primary, flex: 2 }]} onPress={save}>
                <Text style={styles.sheetBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function Field({ label, value, onChange, numeric, flex }: {
  label: string; value: string; onChange: (v: string) => void; numeric?: boolean; flex?: boolean
}) {
  return (
    <View style={[{ marginBottom: 10 }, flex && { flex: 1 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  toolbar: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 0 },
  search: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: colors.text,
  },
  addBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  addBtnText: { color: colors.onPrimary, fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border,
  },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  price: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 40 },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18,
  },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 14 },
  fieldLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: colors.text,
  },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  sheetBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  sheetBtnText: { color: colors.onPrimary, fontWeight: '700' },
})
