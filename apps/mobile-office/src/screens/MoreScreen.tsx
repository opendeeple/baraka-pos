import { View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Icon, ListRow, Screen, useTheme } from '@baraka/mobile-ui'
import { spacing } from '@baraka/ui-tokens'
import type { MoreStackParamList } from '../navigation'

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreMenu'>

// Keeps the bottom tab bar at 6 destinations — these and future
// mobile-parity features (warehouse, purchases) live here as drill-ins
// instead of each claiming their own tab.
export function MoreScreen({ navigation }: Props) {
  const theme = useTheme()
  return (
    <Screen scroll>
      <View style={{ gap: spacing.sm }}>
        <ListRow
          title="Expenses"
          subtitle="Rent, utilities, salaries, supplies…"
          left={<Icon name="receipt" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Expenses')}
        />
        <ListRow
          title="Warehouse"
          subtitle="Receive deliveries, transfer stock to the shop"
          left={<Icon name="warehouse" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Warehouse')}
        />
        <ListRow
          title="Purchases"
          subtitle="Order from suppliers, receive deliveries"
          left={<Icon name="truck" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Purchases')}
        />
        <ListRow
          title="Categories"
          subtitle="Group products for filtering and reports"
          left={<Icon name="tags" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Categories')}
        />
        <ListRow
          title="Suppliers"
          subtitle="Who the shop buys from, and what's owed"
          left={<Icon name="truck" color={theme.primary} />}
          right={<Icon name="chevronRight" size={20} color={theme.textFaint} />}
          onPress={() => navigation.navigate('Suppliers')}
        />
      </View>
    </Screen>
  )
}
