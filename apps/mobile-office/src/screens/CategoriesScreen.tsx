import { useCallback, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
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
  Text,
} from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'

const EMPTY_FORM = { name: '', description: '' }

export function CategoriesScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
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
      toast.error(t('common.nameRequired'))
      return
    }
    if (editId) repos.categories.update(editId, form.name, form.description)
    else repos.categories.create(form.name, form.description)
    setShowForm(false)
    toast.success(editId ? t('categories.updated') : t('categories.created'))
    load()
  }

  function confirmDelete() {
    if (!deleteTarget) return
    repos.categories.softDelete(deleteTarget.id)
    toast.success(t('categories.deleted', { name: deleteTarget.name }))
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
          placeholder={t('categories.searchPlaceholder')}
          returnKeyType="search"
          left={<Icon name="search" size={16} color={theme.textFaint} />}
          containerStyle={styles.searchWrap}
        />
        <Button title={t('common.new')} icon="plus" onPress={openCreate} />
      </View>

      <FlatList
        data={categories}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.description || t('categories.productCount', { count: item.productCount })}
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
                accessibilityLabel={`${t('common.delete')} ${item.name}`}
                onPress={() => setDeleteTarget(item)}
              />
            }
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="package"
            title={search ? t('categories.noneFound') : t('categories.noneYet')}
            message={search ? t('common.tryDifferentSearch') : t('categories.emptyHint')}
            action={search ? undefined : { label: t('categories.newCategory'), onPress: openCreate }}
          />
        }
      />

      <Sheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? t('categories.editCategory') : t('categories.newCategory')}
        footer={
          <View style={styles.actions}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setShowForm(false)} style={styles.flex1} />
            <Button title={t('common.save')} onPress={save} style={styles.flex2} />
          </View>
        }
      >
        <View style={styles.form}>
          <Input label={t('common.name')} value={form.name} onChangeText={(v) => setForm((p) => ({ ...p, name: v }))} autoFocus />
          <Input label={t('common.descriptionOptional')} value={form.description} onChangeText={(v) => setForm((p) => ({ ...p, description: v }))} />
        </View>
      </Sheet>

      <Dialog
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('categories.deleteTitle')}
        message={
          deleteTarget
            ? `${deleteTarget.name}${deleteTarget.productCount > 0 ? `\n${t('categories.deleteWithProducts', { count: deleteTarget.productCount })}` : ''}`
            : ''
        }
        actions={[
          { label: t('common.cancel'), onPress: () => setDeleteTarget(null) },
          { label: t('common.delete'), tone: 'danger', onPress: confirmDelete },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, paddingBottom: 0, alignItems: 'center' },
  searchWrap: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  form: { gap: spacing.sm, paddingBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
})
