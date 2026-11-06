import { useEffect, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { ContactListItem } from '@baraka/data'
import { Badge, Button, EmptyState, Icon, Input, ListRow, Sheet, toast, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

interface Props {
  visible: boolean
  onClose: () => void
  onSelect: (contact: ContactListItem) => void
}

export function CustomerPickerModal({ visible, onClose, onSelect }: Props) {
  const theme = useTheme()
  const { t } = useTranslation()
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
    if (!newName.trim()) {
      toast.error(t('pos.customerNameRequired'))
      return
    }
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
    <Sheet visible={visible} onClose={onClose} title={t('pos.selectCustomer')}>
      <Input
        value={search}
        onChangeText={setSearch}
        placeholder={t('pos.searchNameOrPhone')}
        left={<Icon name="search" size={16} color={theme.textFaint} />}
        returnKeyType="search"
      />
      <FlatList
        data={results}
        keyExtractor={(c) => String(c.id)}
        style={styles.results}
        contentContainerStyle={styles.resultsInner}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.phone ?? '—'}
            onPress={() => onSelect(item)}
            right={item.balance > 0 ? <Badge label={t('pos.debtBadge', { amount: fmtUZS(item.balance) })} tone="danger" /> : undefined}
          />
        )}
        ListEmptyComponent={<EmptyState icon="users" title={t('pos.noCustomersFound')} />}
      />

      {creating ? (
        <View style={styles.createBox}>
          <Input value={newName} onChangeText={setNewName} placeholder={t('pos.customerName')} autoFocus />
          <Input value={newPhone} onChangeText={setNewPhone} placeholder={t('pos.phoneOptional')} keyboardType="phone-pad" />
          <View style={styles.createActions}>
            <Button title={t('common.back')} variant="secondary" onPress={() => setCreating(false)} style={styles.flex1} />
            <Button title={t('pos.createAndSelect')} onPress={createAndSelect} style={styles.flex2} />
          </View>
        </View>
      ) : (
        <Button
          title={t('pos.newCustomer')}
          icon="plus"
          variant="secondary"
          onPress={() => setCreating(true)}
          style={styles.newBtn}
        />
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  results: { maxHeight: 320, flexShrink: 1, marginTop: spacing.sm },
  resultsInner: { gap: spacing.xs },
  createBox: { marginTop: spacing.sm, gap: spacing.sm },
  createActions: { flexDirection: 'row', gap: spacing.sm },
  newBtn: { marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
