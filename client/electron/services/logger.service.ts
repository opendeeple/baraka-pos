import { app } from 'electron'
import { createWriteStream, mkdirSync, WriteStream } from 'fs'
import { join } from 'path'

let logStream: WriteStream | null = null

function getLogPath(): string {
  const logsDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logsDir, { recursive: true })
  const date = new Date().toISOString().split('T')[0]
  return join(logsDir, `baraka-${date}.log`)
}

function ensureStream(): WriteStream {
  if (!logStream) {
    logStream = createWriteStream(getLogPath(), { flags: 'a' })
  }
  return logStream
}

function formatLine(level: string, message: string, data?: unknown): string {
  const ts = new Date().toISOString()
  const extra = data ? ` | ${JSON.stringify(data)}` : ''
  return `[${ts}] [${level}] ${message}${extra}\n`
}

export const logger = {
  info: (msg: string, data?: unknown) => {
    const line = formatLine('INFO', msg, data)
    process.stdout.write(line)
    try { ensureStream().write(line) } catch {}
  },
  warn: (msg: string, data?: unknown) => {
    const line = formatLine('WARN', msg, data)
    process.stdout.write(line)
    try { ensureStream().write(line) } catch {}
  },
  error: (msg: string, err?: unknown) => {
    const errData = err instanceof Error
      ? { message: err.message, stack: err.stack }
      : err
    const line = formatLine('ERROR', msg, errData)
    process.stderr.write(line)
    try { ensureStream().write(line) } catch {}
  },
  close: () => {
    logStream?.end()
    logStream = null
  },
  getLogPath,
}
