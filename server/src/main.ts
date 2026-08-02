import http from 'http'
import app from './app'
import { initSocket } from './socket'
import { env } from './config/env'
import { prisma } from './config/database'

const server = http.createServer(app)
initSocket(server)

server.listen(env.PORT, async () => {
  try {
    await prisma.$connect()
    console.log(`✅ BarakaPOS Server running on port ${env.PORT}`)
    console.log(`   Mode: ${env.NODE_ENV}`)
  } catch (err) {
    console.error('❌ Database connection failed:', err)
    process.exit(1)
  }
})

process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  server.close()
})
