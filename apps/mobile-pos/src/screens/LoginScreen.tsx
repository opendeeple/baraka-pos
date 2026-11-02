import { LoginScreen as SharedLoginScreen } from '@baraka/mobile-shell'
import { useTranslation } from '@baraka/mobile-i18n'

export function LoginScreen() {
  const { t } = useTranslation()
  return <SharedLoginScreen subtitle={t('auth.posSubtitle')} />
}
