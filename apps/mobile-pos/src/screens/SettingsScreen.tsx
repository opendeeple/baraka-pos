import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SettingsScreen as SharedSettingsScreen } from '@baraka/mobile-shell'
import { Button, SectionHeader } from '@baraka/mobile-ui'
import type { RootStackParamList } from '../navigation'

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  return (
    <SharedSettingsScreen
      extras={
        <>
          <SectionHeader title="Receipt printer" />
          <Button
            title="Printer setup"
            icon="printer"
            variant="secondary"
            onPress={() => navigation.navigate('PrinterSettings')}
            fullWidth
          />
        </>
      }
    />
  )
}
