import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react'
import { DEFAULT_SERVER_URL } from '@baraka/shared'
import { useAuthStore } from '../../store/auth.store'
import { Modal, Button } from '../ui'

// Shifts live on the server only (the cross-terminal rule is decided there),
// so the report reads them straight from it. Dev override: VITE_SERVER_URL.
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL

interface ShiftRow {
  id: number
  startedAt: string
  endedAt: string | null
  lastSeenAt: string
  endReason: string | null
  user: { id: number; name: string; role: string }
  deviceName: string
}

interface DaySummary {
  key: string
  firstIn: Date
  /** null while a shift that day is still open. */
  lastOut: Date | null
  minutes: number
  devices: string[]
}

interface EmployeeSummary {
  user: ShiftRow['user']
  days: DaySummary[]
  totalMinutes: number
  openShift: ShiftRow | null
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Days are keyed by the local date the shift started on — a shift past
// midnight counts toward the day the employee came in.
function summarize(shifts: ShiftRow[], now: Date): EmployeeSummary[] {
  const byUser = new Map<number, EmployeeSummary>()
  for (const s of shifts) {
    let emp = byUser.get(s.user.id)
    if (!emp) {
      emp = { user: s.user, days: [], totalMinutes: 0, openShift: null }
      byUser.set(s.user.id, emp)
    }
    const start = new Date(s.startedAt)
    const end = s.endedAt ? new Date(s.endedAt) : null
    const minutes = Math.max(0, ((end ?? now).getTime() - start.getTime()) / 60_000)
    if (!end) emp.openShift = s

    const key = localDayKey(start)
    let day = emp.days.find((d) => d.key === key)
    if (!day) {
      day = { key, firstIn: start, lastOut: end, minutes: 0, devices: [] }
      emp.days.push(day)
    }
    if (start < day.firstIn) day.firstIn = start
    if (!end) day.lastOut = null
    else if (day.lastOut && end > day.lastOut) day.lastOut = end
    day.minutes += minutes
    if (!day.devices.includes(s.deviceName)) day.devices.push(s.deviceName)
    emp.totalMinutes += minutes
  }
  return [...byUser.values()].sort((a, b) => a.user.name.localeCompare(b.user.name))
}

export function AttendanceReport({ roleLabel }: { roleLabel: (role: string) => string }) {
  const { t, i18n } = useTranslation()
  const token = useAuthStore((s) => s.token)
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [ending, setEnding] = useState<ShiftRow | null>(null)
  const [endingBusy, setEndingBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setFailed(false)
    try {
      const from = month.toISOString()
      const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString()
      const res = await window.electronAPI.reports.fetch(
        `${SERVER_URL}/api/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token
      ) as { shifts: ShiftRow[] }
      setShifts(res.shifts)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [month, token])

  useEffect(() => { load() }, [load])

  const summaries = useMemo(() => summarize(shifts, new Date()), [shifts])

  async function adminEnd() {
    if (!ending || !token) return
    setEndingBusy(true)
    try {
      await window.electronAPI.reports.post(`${SERVER_URL}/api/shifts/${ending.id}/end`, token, {})
      setEnding(null)
      await load()
    } catch {
      toast.error(t('employees.attendanceLoadFailed'))
    } finally {
      setEndingBusy(false)
    }
  }

  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const duration = (minutes: number) => {
    const total = Math.round(minutes)
    return t('employees.durationHm', { h: Math.floor(total / 60), m: total % 60 })
  }
  const monthLabel = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(month)
  const isCurrentMonth = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth()

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-dark-surface border border-dark-border rounded-xl p-1">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-lg hover:bg-dark-card"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-white text-sm font-medium min-w-[150px] text-center capitalize">{monthLabel}</span>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            disabled={isCurrentMonth}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-lg hover:bg-dark-card disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} loading={loading} onClick={load}>
          {t('common.refresh')}
        </Button>
      </div>

      {failed ? (
        <p className="text-red-400 text-sm py-8 text-center">{t('employees.attendanceLoadFailed')}</p>
      ) : !loading && summaries.length === 0 ? (
        <p className="text-gray-600 text-sm py-12 text-center">{t('employees.attendanceEmpty')}</p>
      ) : (
        <div className="bg-dark-surface border border-dark-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-dark-border">
                <th className="text-left font-medium px-4 py-3">{t('employees.employee')}</th>
                <th className="text-right font-medium px-4 py-3">{t('employees.daysWorked')}</th>
                <th className="text-right font-medium px-4 py-3">{t('employees.totalTime')}</th>
                <th className="text-right font-medium px-4 py-3">{t('employees.avgPerDay')}</th>
                <th className="text-left font-medium px-4 py-3">{t('employees.now')}</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((emp) => (
                <Fragment key={emp.user.id}>
                  <tr
                    onClick={() => setExpanded(expanded === emp.user.id ? null : emp.user.id)}
                    className="border-b border-dark-card hover:bg-dark-card cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ChevronDown size={14} className={`text-gray-500 transition-transform ${expanded === emp.user.id ? '' : '-rotate-90'}`} />
                        <div>
                          <p className="text-white font-medium">{emp.user.name}</p>
                          <p className="text-xs text-gray-500">{roleLabel(emp.user.role)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-white font-medium">{emp.days.length}</td>
                    <td className="px-4 py-3 text-right text-white font-medium">{duration(emp.totalMinutes)}</td>
                    <td className="px-4 py-3 text-right text-gray-400">{duration(emp.totalMinutes / emp.days.length)}</td>
                    <td className="px-4 py-3">
                      {emp.openShift ? (
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1.5 text-green-400 text-xs whitespace-nowrap">
                            <span className="w-2 h-2 rounded-full bg-green-400" />
                            {t('employees.onShiftSince', {
                              time: time(new Date(emp.openShift.startedAt)),
                              device: emp.openShift.deviceName,
                            })}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEnding(emp.openShift) }}
                            className="text-xs text-gray-400 hover:text-red-400 underline-offset-2 hover:underline"
                          >
                            {t('employees.endShift')}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                  {expanded === emp.user.id && (
                    <tr className="bg-dark">
                      <td colSpan={5} className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left font-medium pb-2">{t('common.date')}</th>
                              <th className="text-left font-medium pb-2">{t('employees.arrived')}</th>
                              <th className="text-left font-medium pb-2">{t('employees.left')}</th>
                              <th className="text-right font-medium pb-2">{t('employees.worked')}</th>
                              <th className="text-left font-medium pb-2 pl-6">{t('employees.terminal')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {emp.days.map((d) => (
                              <tr key={d.key} className="border-t border-dark-card">
                                <td className="py-1.5 text-gray-300">
                                  {d.firstIn.toLocaleDateString(i18n.language, { weekday: 'short', day: '2-digit', month: 'short' })}
                                </td>
                                <td className="py-1.5 text-white">{time(d.firstIn)}</td>
                                <td className="py-1.5 text-white">
                                  {d.lastOut ? (
                                    time(d.lastOut)
                                  ) : (
                                    <span className="text-green-400">{t('employees.stillOnShift')}</span>
                                  )}
                                </td>
                                <td className="py-1.5 text-right text-white">{duration(d.minutes)}</td>
                                <td className="py-1.5 text-gray-500 pl-6">{d.devices.join(', ')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!ending}
        onClose={() => setEnding(null)}
        title={t('employees.endShift')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setEnding(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" className="flex-1" loading={endingBusy} onClick={adminEnd}>{t('employees.endShift')}</Button>
          </>
        }
      >
        <p className="p-5 text-sm text-gray-400">
          {t('employees.endShiftConfirm', { name: ending?.user.name ?? '', device: ending?.deviceName ?? '' })}
        </p>
      </Modal>
    </div>
  )
}
