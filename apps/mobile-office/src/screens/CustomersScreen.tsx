import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
import {
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
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { useAuthStore } from '../platform/authStore'
import { buildDebtMessage, buildHistoryMessage, sendTelegramMessage, telegramConfigured } from '../lib/telegram'

const EMPTY_FORM = { name: '', phone: '', email: '', address: '' }

export function CustomersScreen() {
  const theme = useTheme()
  const { repos, engine } = getServices()
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<ContactListItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [messageTarget, setMessageTarget] = useState<ContactListItem | null>(null)

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
              <View style={styles.rowRight}>
                {item.balance > 0 ? (
                  <Badge label={`Debt ${fmtUZS(item.balance)}`} tone="danger" />
                ) : (
                  <Text style={[typeScale.sm, { color: theme.textMuted }]}>{fmtUZS(item.balance)}</Text>
                )}
                {item.telegramChatId && (
                  <IconButton
                    icon="send"
                    size={20}
                    color={theme.primary}
                    accessibilityLabel={`Message ${item.name} on Telegram`}
                    onPress={() => setMessageTarget(item)}
                  />
                )}
              </View>
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

      {messageTarget && (
        <MessageSheet contact={messageTarget} onClose={() => setMessageTarget(null)} />
      )}
    </Screen>
  )
}

function MessageSheet({ contact, onClose }: { contact: ContactListItem; onClose: () => void }) {
  const theme = useTheme()
  const { repos } = getServices()
  const { store } = useAuthStore()
  const [template, setTemplate] = useState<'debt' | 'history'>(contact.balance > 0 ? 'debt' : 'history')
  const [sending, setSending] = useState(false)

  const configured = telegramConfigured()
  const preview = !configured || !contact.telegramChatId
    ? ''
    : template === 'debt'
      ? buildDebtMessage(contact.id, store?.name ?? '')
      : buildHistoryMessage(contact.id)

  async function send() {
    if (!contact.telegramChatId || sending) return
    setSending(true)
    try {
      const result = await sendTelegramMessage(contact.telegramChatId, preview)
      repos.contacts.logMessage(contact.id, 'telegram', preview, result.success ? 'sent' : 'failed', result.error)
      if (result.success) {
        toast.success('Message sent')
        onClose()
      } else {
        toast.error(result.error || 'Send failed')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet visible onClose={onClose} title={`Message — ${contact.name}`}>
      <View style={styles.form}>
        {!configured ? (
          <Text style={[typeScale.sm, { color: theme.warning }]}>
            Telegram bot isn't configured yet — set it up in desktop Settings first.
          </Text>
        ) : !contact.telegramChatId ? (
          <Text style={[typeScale.sm, { color: theme.warning }]}>
            This customer hasn't connected Telegram yet — send them the bot link from desktop.
          </Text>
        ) : (
          <>
            <View style={styles.chipRow}>
              <Chip label="Debt reminder" selected={template === 'debt'} onPress={() => setTemplate('debt')} />
              <Chip label="Purchase history" selected={template === 'history'} onPress={() => setTemplate('history')} />
            </View>
            <View style={[styles.preview, { borderColor: theme.border }]}>
              <Text style={[typeScale.xs, { color: theme.textMuted }]}>{preview}</Text>
            </View>
          </>
        )}
        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.flex1} />
          <Button
            title="Send"
            icon="send"
            onPress={send}
            loading={sending}
            disabled={!configured || !contact.telegramChatId}
            style={styles.flex2}
          />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0, alignItems: 'flex-start' },
  searchWrap: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.xs },
  preview: { borderWidth: 1, borderRadius: 8, padding: spacing.sm, maxHeight: 220 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
