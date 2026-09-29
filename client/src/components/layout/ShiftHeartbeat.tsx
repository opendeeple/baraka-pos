import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useShiftStore, endShiftAndSignOut } from '../../store/shift.store'

const HEARTBEAT_MS = 60_000

const ENDED_MESSAGE_KEYS: Record<string, string> = {
  replaced: 'shift.endedReplaced',
  admin: 'shift.endedAdmin',
}

/**
 * Tells the server this terminal's shift is still going and signs the
 * cashier out once the server says it's over (another cashier took the
 * terminal, or a manager ended it). Losing the connection never ends the
 * shift: it's flagged offline, selling carries on, and the next beat that
 * gets through simply resumes it.
 */
export function ShiftHeartbeat() {
  const shiftId = useShiftStore((s) => s.shift?.id)
  const setOffline = useShiftStore((s) => s.setOffline)
  const navigate = useNavigate()
  const { t } = useTranslation()

  useEffect(() => {
    if (!shiftId) return
    const timer = setInterval(async () => {
      const res = await window.electronAPI.shift.heartbeat(shiftId).catch(() => null)
      if (!res || res.status === 0) { setOffline(true); return }
      if (res.status !== 200) return
      setOffline(false)
      const data = res.data as { active: boolean; endReason?: string | null }
      if (data.active) return
      toast.warning(t(ENDED_MESSAGE_KEYS[data.endReason ?? ''] ?? 'shift.ended'))
      await endShiftAndSignOut()
      navigate('/login', { replace: true })
    }, HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [shiftId, setOffline, navigate, t])

  return null
}
