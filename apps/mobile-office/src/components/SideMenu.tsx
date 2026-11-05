import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, IconButton, ListRow, useTheme, type IconName } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { motion, radius, spacing, type as typeScale } from '@baraka/ui-tokens'
import type { RootStackParamList } from '../navigation'

type MenuScreen = keyof Omit<RootStackParamList, 'Tabs'>

export interface SideMenuProps {
  visible: boolean
  onClose: () => void
  onNavigate: (screen: MenuScreen) => void
}

const ITEMS: Array<{ screen: MenuScreen; icon: IconName; titleKey: string; subtitleKey: string }> = [
  { screen: 'Expenses', icon: 'receipt', titleKey: 'nav.expenses', subtitleKey: 'more.expensesSubtitle' },
  { screen: 'Warehouse', icon: 'warehouse', titleKey: 'nav.warehouse', subtitleKey: 'more.warehouseSubtitle' },
  { screen: 'Purchases', icon: 'truck', titleKey: 'nav.purchases', subtitleKey: 'more.purchasesSubtitle' },
  { screen: 'Categories', icon: 'tags', titleKey: 'nav.categories', subtitleKey: 'more.categoriesSubtitle' },
  { screen: 'Suppliers', icon: 'truck', titleKey: 'nav.suppliers', subtitleKey: 'more.suppliersSubtitle' },
  { screen: 'Creditors', icon: 'banknote', titleKey: 'nav.creditors', subtitleKey: 'more.creditorsSubtitle' },
  { screen: 'Employees', icon: 'users', titleKey: 'nav.employees', subtitleKey: 'more.employeesSubtitle' },
  { screen: 'Journal', icon: 'history', titleKey: 'nav.journal', subtitleKey: 'more.journalSubtitle' },
  { screen: 'Reports', icon: 'barChart', titleKey: 'nav.reports', subtitleKey: 'more.reportsSubtitle' },
]

/**
 * Left slide-out menu for the "More" destinations. A plain Animated+Pressable
 * overlay (not react-navigation's drawer) so it needs no new native deps
 * (gesture-handler/reanimated) — matches Sheet.tsx's animation approach,
 * sliding from the left instead of the bottom.
 */
export function SideMenu({ visible, onClose, onNavigate }: SideMenuProps) {
  const theme = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const panelWidth = Math.min(320, windowWidth * 0.82)
  const slide = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(slide, { toValue: 1, duration: motion.base, useNativeDriver: true }).start()
    } else {
      Animated.timing(slide, { toValue: 0, duration: motion.base, useNativeDriver: true }).start(() => setMounted(false))
    }
  }, [visible, slide])

  if (!mounted) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[styles.scrim, { backgroundColor: theme.overlay, opacity: slide }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('common.close')} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            backgroundColor: theme.surface,
            paddingTop: Math.max(insets.top, spacing.md),
            paddingBottom: Math.max(insets.bottom, spacing.md),
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] }) }],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={[typeScale.lg, { color: theme.text, fontWeight: '700' }]}>{t('nav.moreMenu')}</Text>
          <IconButton icon="x" size={20} accessibilityLabel={t('common.close')} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {ITEMS.map((item) => (
            <ListRow
              key={item.screen}
              title={t(item.titleKey)}
              subtitle={t(item.subtitleKey)}
              left={<Icon name={item.icon} color={theme.primary} />}
              right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
              onPress={() => onNavigate(item.screen)}
            />
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
})
