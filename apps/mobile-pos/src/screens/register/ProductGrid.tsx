import { memo, useCallback } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Pressable } from 'react-native'
import { fmtUZS } from '@baraka/app-core'
import type { CategoryItem, ProductListItem } from '@baraka/data'
import { Badge, Chip, EmptyState, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { opacity, radius, spacing, type as typeScale } from '@baraka/ui-tokens'

interface ProductGridProps {
  products: ProductListItem[]
  categories: CategoryItem[]
  categoryId: number | null
  onCategory: (id: number | null) => void
  onAdd: (product: ProductListItem) => void
  twoPane: boolean
}

/** Memoized tile: the grid must not re-render when only the cart changes. */
const ProductTile = memo(function ProductTile({
  item,
  onAdd,
}: {
  item: ProductListItem
  onAdd: (p: ProductListItem) => void
}) {
  const theme = useTheme()
  const { t } = useTranslation()
  const low = item.isStockManaged && item.stock > 0 && item.alertQuantity > 0 && item.stock <= item.alertQuantity
  const out = item.isStockManaged && item.stock <= 0
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${item.name}`}
      onPress={() => onAdd(item)}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
        pressed && { opacity: opacity.pressed, transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text style={[typeScale.sm, { color: theme.text, fontWeight: '600' }]} numberOfLines={2}>
        {item.isFeatured ? '★ ' : ''}
        {item.name}
      </Text>
      <View>
        <Text style={[typeScale.money, { color: theme.primary }]}>{fmtUZS(item.price)}</Text>
        {item.isStockManaged ? (
          out ? (
            <Badge label={t('pos.outOfStock')} tone="danger" />
          ) : low ? (
            <Badge label={t('pos.lowStock', { stock: item.stock })} tone="warning" />
          ) : (
            <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('pos.stock', { stock: item.stock })}</Text>
          )
        ) : (
          <Text style={[typeScale.xs, { color: theme.textFaint }]}>{t('pos.unlimited')}</Text>
        )}
      </View>
    </Pressable>
  )
})

export function ProductGrid({ products, categories, categoryId, onCategory, onAdd, twoPane }: ProductGridProps) {
  const { t } = useTranslation()
  const renderItem = useCallback(
    ({ item }: { item: ProductListItem }) => <ProductTile item={item} onAdd={onAdd} />,
    [onAdd]
  )

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={styles.chipsInner}
      >
        <Chip label={t('pos.all')} selected={categoryId === null} onPress={() => onCategory(null)} />
        {categories.map((c) => (
          <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => onCategory(c.id)} />
        ))}
      </ScrollView>
      <FlatList
        data={products}
        numColumns={twoPane ? 4 : 2}
        key={twoPane ? 'wide' : 'narrow'}
        keyExtractor={(p) => String(p.id)}
        columnWrapperStyle={styles.columnGap}
        contentContainerStyle={styles.listInner}
        keyboardShouldPersistTaps="handled"
        renderItem={renderItem}
        ListEmptyComponent={<EmptyState icon="package" title={t('pos.noProducts')} message={t('pos.noProductsHint')} />}
      />
    </>
  )
}

const styles = StyleSheet.create({
  chips: { flexGrow: 0, marginBottom: spacing.sm },
  chipsInner: { gap: spacing.sm },
  columnGap: { gap: spacing.sm },
  listInner: { gap: spacing.sm, paddingBottom: 96, flexGrow: 1 },
  tile: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    minHeight: 96,
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
})
