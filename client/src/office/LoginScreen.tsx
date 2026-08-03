import LoginScreen from '../screens/auth/LoginScreen'

// Thin wrapper — all login logic lives in screens/auth/LoginScreen.tsx; the
// 'office' variant restores via auth.me and routes to /backoffice.
export default function OfficeLoginScreen() {
  return <LoginScreen variant="office" />
}
