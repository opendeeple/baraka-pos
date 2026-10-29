import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { CategoryRow } from '@baraka/data'
import {
  Button,
  Dialog,
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

const EMPTY_FORM = { name: '', description: '' }

export function CategoriesScreen() {
  const theme = useTheme()
  const { repos } = getServices()
  const [search, setSearch] = useState('')
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null)

  const load = useCallback(() => {
    setCategories(repos.categories.list(search || undefined))
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
    if (editId) repos.categories.update(editId, form.name, form.description)
    else repos.categories.create(form.name, form.description)
    setShowForm(false)
    toast.success(editId ? 'Category updated' : 'Category created')
    load()
  }

  function confirmDelete() {
    if (!deleteTarget) return
    repos.categories.softDelete(deleteTarget.id)
    toast.success(`${deleteTarget.name} deleted`)
    setDeleteTarget(null)
    load()
  }

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <Input
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={load}
          placeholder="Search categories…"
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title="New" icon="plus" onPress={openCreate} />
      </View>

      <FlatList
        data={categories}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.description || `${item.productCount} products`}
            onPress={() => {
              setEditId(item.id)
              setForm({ name: item.name, description: item.description ?? '' })
              setShowForm(true)
            }}
            right={
              <IconButton
                icon="trash"
                size={20}
                color={theme.danger}
                accessibilityLabel={`Delete ${item.name}`}
                onPress={() => setDeleteTarget(item)}
              />
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="package"
            title={search ? 'No categories found' : 'No categories yet'}
            message={search ? 'Try a different search' : 'Group products together to filter and report on them'}
            action={search ? undefined : { label: 'New category', onPress: openCreate }}
          />
        }
      />

      <Sheet visible={showForm} onClose={() => setShowForm(false)} title={editId ? 'Edit category' : 'New category'}>
        <View style={styles.form}>
          <Input label="Name" value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} autoFocus />
          <Input label="Description (optional)" value={form.description} onChangeText={(v) => setForm((p) => ({ ...p, description: v }))} />
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title="Save" onPress={save} style={styles.flex2} />
          </View>
        </View>
      </Sheet>

      <Dialog
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete category?"
        message={
          deleteTarget
            ? `${deleteTarget.name}${deleteTarget.productCount > 0 ? `\n${deleteTarget.productCount} products still use this category.` : ''}`
            : ''
        }
        actions={[
          { label: 'Cancel', onPress: () => setDeleteTarget(null) },
          { label: 'Delete', tone: 'danger', onPress: confirmDelete },
        ]}
      />
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
