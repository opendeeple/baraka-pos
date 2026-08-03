import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth.store'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { UpdateBanner } from '../components/layout/UpdateBanner'
import { AppToaster } from '../components/ui/AppToaster'
import { AppModeProvider } from '../contexts/AppModeContext'
import OfficeLoginScreen from './LoginScreen'

// Lazy-loaded so each screen (and recharts, only used by Dashboard/Reports)
// ships in its own chunk instead of one ~1.5MB bundle loaded on every launch.
const DashboardScreen = lazy(() => import('../screens/backoffice/DashboardScreen'))
const ProductsScreen = lazy(() => import('../screens/backoffice/ProductsScreen'))
const SalesScreen = lazy(() => import('../screens/backoffice/SalesScreen'))
const CustomersScreen = lazy(() => import('../screens/backoffice/CustomersScreen'))
const PurchasesScreen = lazy(() => import('../screens/backoffice/PurchasesScreen'))
const ExpensesScreen = lazy(() => import('../screens/backoffice/ExpensesScreen'))
const ReportsScreen = lazy(() => import('../screens/backoffice/ReportsScreen'))
const EmployeesScreen = lazy(() => import('../screens/backoffice/EmployeesScreen'))
const SettingsScreen = lazy(() => import('../screens/backoffice/SettingsScreen'))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

const backofficeRoutes = [
  { path: '/backoffice', element: <DashboardScreen /> },
  { path: '/backoffice/products', element: <ProductsScreen /> },
  { path: '/backoffice/sales', element: <SalesScreen /> },
  { path: '/backoffice/customers', element: <CustomersScreen /> },
  { path: '/backoffice/purchases', element: <PurchasesScreen /> },
  { path: '/backoffice/expenses', element: <ExpensesScreen /> },
  { path: '/backoffice/reports', element: <ReportsScreen /> },
  { path: '/backoffice/employees', element: <EmployeesScreen /> },
  { path: '/backoffice/settings', element: <SettingsScreen /> },
]

export default function App() {
  return (
    <AppModeProvider value="office">
      <AppToaster />
      <ErrorBoundary>
        <div className="flex flex-col h-screen">
          <UpdateBanner />
          <div className="flex-1 overflow-hidden">
            <HashRouter>
              <Suspense fallback={
                <div className="flex h-full items-center justify-center text-gray-500 text-sm">Loading…</div>
              }>
                <Routes>
                  <Route path="/login" element={<OfficeLoginScreen />} />

                  {backofficeRoutes.map(({ path, element }) => (
                    <Route key={path} path={path} element={
                      <RequireAuth>
                        <ErrorBoundary>{element}</ErrorBoundary>
                      </RequireAuth>
                    } />
                  ))}

                  <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
              </Suspense>
            </HashRouter>
          </div>
        </div>
      </ErrorBoundary>
    </AppModeProvider>
  )
}
