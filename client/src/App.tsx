import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth.store'
import { useSessionStore } from './store/session.store'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TrainingBanner } from './components/layout/TrainingBanner'
import { UpdateBanner } from './components/layout/UpdateBanner'
import { Toaster } from 'sonner'
import { AppModeProvider } from './contexts/AppModeContext'
import LoginScreen from './screens/auth/LoginScreen'
import OpenSessionScreen from './screens/session/OpenSessionScreen'
import CloseSessionScreen from './screens/session/CloseSessionScreen'
import POSScreen from './screens/pos/POSScreen'
import POSSettingsScreen from './screens/pos/POSSettingsScreen'
import CustomerDisplay from './screens/pos/CustomerDisplay'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireSession({ children }: { children: React.ReactNode }) {
  const session = useSessionStore((s) => s.session)
  if (!session) return <Navigate to="/session/open" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AppModeProvider value="pos">
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#1e2130', border: '1px solid #2a2d3e', color: '#fff' },
          duration: 4000,
        }}
        richColors
      />
      <ErrorBoundary>
        <div className="flex flex-col h-screen">
          <TrainingBanner />
          <UpdateBanner />
          <div className="flex-1 overflow-hidden">
            <HashRouter>
              <Routes>
                <Route path="/login" element={<LoginScreen />} />
                <Route path="/customer-display" element={<CustomerDisplay />} />

                <Route path="/session/open" element={<RequireAuth><OpenSessionScreen /></RequireAuth>} />
                <Route path="/session/close" element={<RequireAuth><CloseSessionScreen /></RequireAuth>} />

                <Route path="/pos" element={
                  <RequireAuth><RequireSession>
                    <ErrorBoundary>
                      <POSScreen />
                    </ErrorBoundary>
                  </RequireSession></RequireAuth>
                } />

                <Route path="/pos/settings" element={
                  <RequireAuth><RequireSession>
                    <POSSettingsScreen />
                  </RequireSession></RequireAuth>
                } />

                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </HashRouter>
          </div>
        </div>
      </ErrorBoundary>
    </AppModeProvider>
  )
}
