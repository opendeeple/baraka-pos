import { z } from 'zod'
import dotenv from 'dotenv'
dotenv.config()

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SYNC_API_KEY: z.string().min(8),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Optional: Telegram reminders/purchase-history messages are disabled
  // (endpoints no-op with a clear error) until this is set, rather than the
  // whole server failing to boot without it.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
})

export const env = envSchema.parse(process.env)
