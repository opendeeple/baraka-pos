import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env'
import { errorMiddleware } from './middleware/error.middleware'
import authRouter from './modules/auth/auth.router'
import syncRouter from './modules/sync/sync.router'
import sessionsRouter from './modules/sessions/sessions.router'
import productsRouter from './modules/products/products.router'
import customersRouter from './modules/customers/customers.router'
import salesRouter from './modules/sales/sales.router'
import reportsRouter from './modules/reports/reports.router'
import purchasesRouter from './modules/purchases/purchases.router'
import expensesRouter from './modules/expenses/expenses.router'
import employeesRouter from './modules/employees/employees.router'
import settingsRouter from './modules/settings/settings.router'
import devicesRouter from './modules/devices/devices.router'
import notificationsRouter from './modules/notifications/notifications.router'
import syncV2Router from './modules/sync/syncV2.router'

const app = express()

app.use(helmet())
app.use(cors({
  origin: env.NODE_ENV === 'development'
    ? (origin, cb) => cb(null, true)  // allow all origins in dev (Electron + any localhost port)
    : env.CORS_ORIGIN,
  credentials: true,
}))
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'))
app.use(express.json({ limit: '10mb' }))

// Routes
app.use('/api/auth', authRouter)
app.use('/api/sync/v2', syncV2Router)
app.use('/api/sync', syncRouter) // v1 — deprecated, kept for the Electron fleet transition
app.use('/api/devices', devicesRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/products', productsRouter)
app.use('/api/customers', customersRouter)
app.use('/api/sales', salesRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/purchases', purchasesRouter)
app.use('/api/expenses', expensesRouter)
app.use('/api/employees', employeesRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/notifications', notificationsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' })
})

app.use(errorMiddleware)

export default app
