/**
 * Resets one user's password directly in the database — for recovering
 * access when nobody currently has a working login (e.g. the admin
 * password was changed during a go-live reset and not written down).
 * Connects via the same DATABASE_URL Prisma already uses; touches nothing
 * else — not stock, not other users, not any other table.
 *
 * Usage: npx tsx scripts/reset-admin-password.ts <username> <newPassword>
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const [username, newPassword] = process.argv.slice(2)
  if (!username || !newPassword) {
    console.error('Usage: npx tsx scripts/reset-admin-password.ts <username> <newPassword>')
    process.exit(1)
  }
  const user = await prisma.user.findUnique({ where: { username } })
  if (!user) {
    console.error(`No user with username "${username}"`)
    process.exit(1)
  }
  const passwordHash = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
  console.log(`Password reset for "${user.username}" (role: ${user.role}, id: ${user.id})`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
