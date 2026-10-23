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
      </View>
    </Screen>
  )
}
