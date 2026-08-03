import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
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

const EMPTY_FORM = { name: '', phone: '', email: '', address: '' }

export function CustomersScreen() {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<ContactListItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = useCallback(() => {
    setCustomers(repos.contacts.search(search, 100))
  }, [search])

  useFocusEffect(load)

  function openCreate() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function save() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
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
    toast.success(editId ? 'Customer updated' : 'Customer created')
    load()
  }

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder="Search by name or phone…"
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title="New" icon="plus" onPress={openCreate} />
      </View>

      <FlatList
        data={customers}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.phone ?? '—'}
            onPress={() => {
              setEditId(item.id)
              setForm({
                name: item.name,
                phone: item.phone ?? '',
                email: item.email ?? '',
                address: item.address ?? '',
              })
              setShowForm(true)
            }}
            right={
              item.balance > 0 ? (
                <Badge label={`Debt ${fmtUZS(item.balance)}`} tone="danger" />
              ) : (
                <Text style={[typeScale.sm, { color: theme.textMuted }]}>{fmtUZS(item.balance)}</Text>
              )
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title={search ? 'No customers found' : 'No customers yet'}
            message={search ? 'Try a different search' : 'Customers you add appear here'}
            action={search ? undefined : { label: 'New customer', onPress: openCreate }}
          />
        }
      />

      <Sheet visible={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit customer' : 'New customer'}>
        <View style={styles.form}>
          <Input label="Name" value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} />
          <Input
            label="Phone"
            value={form.phone}
            onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))}
            keyboardType="phone-pad"
            placeholder="+998 …"
          />
          <Input
            label="Email"
            value={form.email}
            onChangeText={(v) => setForm((p) => ({ ...p, email: v }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input label="Address" value={form.address} onChangeText={(v) => setForm((p) => ({ ...p, address: v }))} />
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
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
