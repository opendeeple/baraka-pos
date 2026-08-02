import { useCallback, useState } from 'react'
import {
  FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
import { getServices } from '../platform/services'
import { colors } from '../theme'

export function CustomersScreen() {
  const { repos, engine } = getServices()
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<ContactListItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '' })

  const load = useCallback(() => {
    setCustomers(repos.contacts.search(search, 100))
  }, [search])

  useFocusEffect(load)

  function save() {
    if (!form.name.trim()) return
    const input = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
    }
    if (editId) repos.contacts.update(editId, input)
    else repos.contacts.create(input)
    engine.flushOutbox().catch(() => {})
    setShowForm(false)
    load()
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder="Search by name or phone…"
          placeholderTextColor={colors.textMuted}
        />
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => { setEditId(null); setForm({ name: '', phone: '', email: '', address: '' }); setShowForm(true) }}
        >
          <Text style={styles.addBtnText}>＋ New</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={customers}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => {
              setEditId(item.id)
              setForm({ name: item.name, phone: item.phone ?? '', email: item.email ?? '', address: item.address ?? '' })
              setShowForm(true)
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.phone ?? '—'}</Text>
            </View>
            <Text style={[styles.balance, item.balance > 0 && { color: colors.danger }]}>
              {item.balance > 0 ? `Debt ${fmtUZS(item.balance)}` : fmtUZS(item.balance)}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No customers</Text>}
      />

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editId ? 'Edit customer' : 'New customer'}</Text>
            {(['name', 'phone', 'email', 'address'] as const).map((k) => (
              <View key={k} style={{ marginBottom: 10 }}>
                <Text style={styles.fieldLabel}>{k[0].toUpperCase() + k.slice(1)}</Text>
                <TextInput
                  style={styles.input}
                  value={form[k]}
                  onChangeText={(v) => setForm((prev) => ({ ...prev, [k]: v }))}
                  autoCapitalize={k === 'email' ? 'none' : 'sentences'}
                  keyboardType={k === 'phone' ? 'phone-pad' : 'default'}
                />
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  toolbar: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 0 },
  search: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: colors.text,
  },
  addBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border,
  },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  balance: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 40 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 14 },
  fieldLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: colors.text,
  },
  sheetBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  sheetBtnText: { color: '#fff', fontWeight: '700' },
})
