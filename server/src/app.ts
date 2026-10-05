import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env'
import { errorMiddleware } from './middleware/error.middleware'
import authRouter from './modules/auth/auth.router'
import reportsRouter from './modules/reports/reports.router'
import syncV2Router from './modules/sync/syncV2.router'
import shiftsRouter from './modules/shifts/shifts.router'

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

// Routes. Every write goes through sync v2 (devices write locally first and
// push), so stock, money and debt rules live in one place — syncV2.service.
// The old REST write endpoints (sales checkout/void, purchases, products,
// adjust-stock, customers, expenses, sessions, settings, notifications,
// employees) and sync v1 were unused by every app and applied different,
// older rules; they're gone.
app.use('/api/auth', authRouter)
app.use('/api/sync/v2', syncV2Router)
app.use('/api/reports', reportsRouter)
app.use('/api/shifts', shiftsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' })
})

app.use(errorMiddleware)

export default app
