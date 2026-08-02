import { useEffect, useState } from 'react'
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
import { getServices } from '../platform/services'
import { colors } from '../theme'

interface Props {
  visible: boolean
  onClose: () => void
  onSelect: (contact: ContactListItem) => void
}

export function CustomerPickerModal({ visible, onClose, onSelect }: Props) {
  const { repos, engine } = getServices()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ContactListItem[]>([])
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (visible) setResults(repos.contacts.search(search, 30))
  }, [visible, search])

  function createAndSelect() {
    if (!newName.trim()) return
    const contact = repos.contacts.create({
      name: newName.trim(),
      phone: newPhone.trim() || null,
    })
    engine.flushOutbox().catch(() => {})
    setCreating(false)
    setNewName('')
    setNewPhone('')
    onSelect(contact)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>Select customer</Text>
          <TextInput
            style={styles.input}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or phone…"
            placeholderTextColor={colors.textMuted}
          />
          <FlatList
            data={results}
            keyExtractor={(c) => String(c.id)}
            style={{ maxHeight: 300 }}
            contentContainerStyle={{ gap: 6 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => onSelect(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>{item.phone ?? '—'}</Text>
                </View>
                {item.balance > 0 && (
                  <Text style={styles.debt}>Debt {fmtUZS(item.balance)}</Text>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No customers found</Text>}
          />

          {creating ? (
            <View style={styles.createBox}>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="Customer name"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={styles.input}
                value={newPhone}
                onChangeText={setNewPhone}
                placeholder="Phone (optional)"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[styles.btn, { backgroundColor: colors.border }]} onPress={() => setCreating(false)}>
                  <Text style={styles.btnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary, flex: 2 }]} onPress={createAndSelect}>
                  <Text style={styles.btnText}>Create & select</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={[styles.btn, styles.newBtn]} onPress={() => setCreating(true)}>
              <Text style={styles.btnText}>＋ New customer</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, maxHeight: '80%',
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: colors.text, marginBottom: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 10, padding: 12, gap: 8,
  },
  name: { color: colors.text, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 12 },
  debt: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  empty: { color: colors.textMuted, textAlign: 'center', marginVertical: 16 },
  btn: {
    flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    justifyContent: 'center', minHeight: 46,
  },
  newBtn: { backgroundColor: colors.border, marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
  createBox: { marginTop: 8 },
})
