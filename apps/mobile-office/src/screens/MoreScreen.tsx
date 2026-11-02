import { View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Icon, ListRow, Screen, useTheme } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing } from '@baraka/ui-tokens'
import type { MoreStackParamList } from '../navigation'

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreMenu'>

// Keeps the bottom tab bar at 6 destinations — these and future
// mobile-parity features (warehouse, purchases) live here as drill-ins
// instead of each claiming their own tab.
export function MoreScreen({ navigation }: Props) {
  const theme = useTheme()
  const { t } = useTranslation()
  return (
    <Screen scroll>
      <View style={{ gap: spacing.sm }}>
        <ListRow
          title={t('nav.expenses')}
          subtitle={t('more.expensesSubtitle')}
          left={<Icon name="receipt" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Expenses')}
        />
        <ListRow
          title={t('nav.warehouse')}
          subtitle={t('more.warehouseSubtitle')}
          left={<Icon name="warehouse" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Warehouse')}
        />
        <ListRow
          title={t('nav.purchases')}
          subtitle={t('more.purchasesSubtitle')}
          left={<Icon name="truck" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Purchases')}
        />
        <ListRow
          title={t('nav.categories')}
          subtitle={t('more.categoriesSubtitle')}
          left={<Icon name="tags" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Categories')}
        />
        <ListRow
          title={t('nav.suppliers')}
          subtitle={t('more.suppliersSubtitle')}
          left={<Icon name="truck" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Suppliers')}
        />
        <ListRow
          title={t('nav.creditors')}
          subtitle={t('more.creditorsSubtitle')}
          left={<Icon name="banknote" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Creditors')}
        />
        <ListRow
          title={t('nav.employees')}
          subtitle={t('more.employeesSubtitle')}
          left={<Icon name="users" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Employees')}
        />
        <ListRow
          title={t('nav.journal')}
          subtitle={t('more.journalSubtitle')}
          left={<Icon name="history" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Journal')}
        />
        <ListRow
          title={t('nav.reports')}
          subtitle={t('more.reportsSubtitle')}
          left={<Icon name="barChart" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Reports')}
        />
      </View>
    </Screen>
  )
}
