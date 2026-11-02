import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SettingsScreen as SharedSettingsScreen } from '@baraka/mobile-shell'
import { Button, SectionHeader } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import type { RootStackParamList } from '../navigation'

export function SettingsScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  return (
    <SharedSettingsScreen
      extras={
        <>
          <SectionHeader title={t('settings.printer')} />
          <Button
            title={t('settings.printerSetup')}
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
