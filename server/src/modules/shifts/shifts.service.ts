import { Shift } from '@prisma/client'
import { prisma } from '../../config/database'
import { signUserToken, toAuthResponse } from '../auth/auth.service'

// A shift only ever ends on an explicit command: "End shift" on its terminal,
// another employee scanning in on that terminal, or a manager ending it.
// Silence never ends it — a terminal that loses internet keeps selling and
// its shift carries on; heartbeats just record lastSeenAt.

export class ShiftError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

function toShiftDto(shift: Shift) {
  return { id: shift.id, userId: shift.userId, startedAt: shift.startedAt }
}

function parseTerminalName(terminalName: unknown): string {
  const name = typeof terminalName === 'string' ? terminalName.trim() : ''
  if (!name || name.length > 100) throw new ShiftError(400, 'TERMINAL_REQUIRED', 'Terminal name is required')
  return name
}

export async function startShift(storeId: number, terminalName: unknown, badgeCode: unknown) {
  const terminal = parseTerminalName(terminalName)
  const code = typeof badgeCode === 'string' ? badgeCode.trim() : ''
  if (!code) throw new ShiftError(400, 'BADGE_REQUIRED', 'Badge code is required')
  const now = new Date()

  const { user, shift } = await prisma.$transaction(async (tx) => {
    // Serializes shift starts within a store: the one-open-shift-per-cashier
    // rule spans terminals, so two terminals scanning the same badge at the
    // same moment must not both see "no open shift" and both open one.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shift_start'), ${storeId}::int)`

    const user = await tx.user.findFirst({
      where: { badgeCode: code, storeId, isActive: true, deletedAt: null },
      include: { store: true },
    })
    if (!user) throw new ShiftError(404, 'BADGE_NOT_FOUND', 'No active employee has this badge')

    const open = await tx.shift.findFirst({
      where: { userId: user.id, endedAt: null },
      include: { device: { select: { name: true } } },
    })
    if (open && open.terminalName !== terminal) {
      throw new ShiftError(409, 'SHIFT_OPEN_ELSEWHERE', `${user.name} has not ended their shift on another terminal`, {
        employeeName: user.name,
        deviceName: open.terminalName || open.device?.name || '',
        startedAt: open.startedAt,
      })
    }

    // Shift change: whoever was working on this terminal hands over now.
    await tx.shift.updateMany({
      where: { storeId, terminalName: terminal, endedAt: null, userId: { not: user.id } },
      data: { endedAt: now, endReason: 'replaced' },
    })

    // Re-scanning on the terminal they're already on continues that shift.
    const shift = open
      ? await tx.shift.update({ where: { id: open.id }, data: { lastSeenAt: now } })
      : await tx.shift.create({
          data: { storeId, userId: user.id, terminalName: terminal, startedAt: now, lastSeenAt: now },
        })
    return { user, shift }
  })

  return { token: signUserToken(user), shift: toShiftDto(shift), ...toAuthResponse(user) }
}

export async function heartbeatShift(storeId: number, terminalName: unknown, shiftId: number) {
  const terminal = parseTerminalName(terminalName)
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, storeId, terminalName: terminal } })
  if (!shift) return { active: false, endReason: 'not_found' }
  if (shift.endedAt) return { active: false, endReason: shift.endReason }
  await prisma.shift.updateMany({ where: { id: shift.id, endedAt: null }, data: { lastSeenAt: new Date() } })
  return { active: true }
}

/**
 * `endedAt` is when the cashier pressed "End shift" on the terminal. It
 * matters when that happened offline: the terminal queues the end and
 * delivers it later, and the hours must stop at the press, not at delivery.
 * Clamped to [startedAt, now] so a skewed terminal clock can't distort them.
 */
export async function endShift(storeId: number, terminalName: unknown, shiftId: number, endedAt?: unknown) {
  const terminal = parseTerminalName(terminalName)
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, storeId, terminalName: terminal, endedAt: null } })
  if (!shift) return { ended: false }
  const now = new Date()
  const requested = typeof endedAt === 'string' ? new Date(endedAt) : now
  const at = Number.isNaN(requested.getTime()) || requested > now
    ? now
    : requested < shift.startedAt ? shift.startedAt : requested
  const { count } = await prisma.shift.updateMany({
    where: { id: shift.id, endedAt: null },
    data: { endedAt: at, endReason: 'logout' },
  })
  return { ended: count > 0 }
}

/** Shifts that started within [from, to), for the attendance report. */
export async function listShifts(storeId: number, from: Date, to: Date) {
  const shifts = await prisma.shift.findMany({
    where: { storeId, startedAt: { gte: from, lt: to } },
    include: {
      user: { select: { id: true, name: true, role: true } },
      device: { select: { name: true } },
    },
    orderBy: { startedAt: 'asc' },
  })
  return shifts.map(({ user, device, ...s }) => ({
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    lastSeenAt: s.lastSeenAt,
    endReason: s.endReason,
    user,
    // Shifts from before terminal names were recorded still name their device.
    deviceName: s.terminalName || device?.name || '',
  }))
}

/** Manager override, e.g. a terminal died mid-shift and the cashier needs to move. */
export async function adminEndShift(storeId: number, shiftId: number) {
  const { count } = await prisma.shift.updateMany({
    where: { id: shiftId, storeId, endedAt: null },
    data: { endedAt: new Date(), endReason: 'admin' },
  })
  if (!count) throw new ShiftError(404, 'SHIFT_NOT_OPEN', 'Shift not found or already ended')
  return { ended: true }
}
