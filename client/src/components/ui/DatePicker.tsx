import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  max?: string
  min?: string
  placeholder?: string
  className?: string
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseYMD(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDisplay(s: string): string {
  const d = parseYMD(s)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function buildGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()
  const cells: Array<{ date: Date; inMonth: boolean }> = []

  for (let i = firstDay - 1; i >= 0; i--)
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), inMonth: false })
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(year, month, d), inMonth: true })
  const rem = 42 - cells.length
  for (let d = 1; d <= rem; d++)
    cells.push({ date: new Date(year, month + 1, d), inMonth: false })

  return cells
}

export function DatePicker({
  value, onChange, max, min, placeholder = 'Pick a date', className = '',
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const today = new Date()
  const todayYMD = toYMD(today)

  const [view, setView] = useState<Date>(() => {
    const d = parseYMD(value)
    return d ? new Date(d.getFullYear(), d.getMonth(), 1)
             : new Date(today.getFullYear(), today.getMonth(), 1)
  })

  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  useEffect(() => {
    const d = parseYMD(value)
    if (d) setView(new Date(d.getFullYear(), d.getMonth(), 1))
  }, [value])

  function isDisabled(d: Date) {
    const ymd = toYMD(d)
    return (!!min && ymd < min) || (!!max && ymd > max)
  }

  const cells = buildGrid(view.getFullYear(), view.getMonth())

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-full flex items-center gap-2 bg-dark-card border rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none ${
          open ? 'border-primary' : 'border-dark-border hover:border-gray-600'
        }`}
      >
        <Calendar size={14} className="text-gray-400 shrink-0" />
        <span className={`flex-1 text-left ${value ? 'text-white' : 'text-gray-500'}`}>
          {value ? formatDisplay(value) : placeholder}
        </span>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-dark-card border border-dark-border rounded-xl shadow-2xl p-3 w-64">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
              className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-dark-surface transition-colors"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-white text-sm font-medium">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
              className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-dark-surface transition-colors"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-gray-600 text-xs py-1 font-medium">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map(({ date, inMonth }, i) => {
              const ymd = toYMD(date)
              const isSelected = ymd === value
              const isToday = ymd === todayYMD
              const disabled = isDisabled(date)

              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => { onChange(ymd); setOpen(false) }}
                  className={`h-8 w-full rounded-lg text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-primary text-white'
                      : isToday && inMonth
                      ? 'bg-primary/20 text-primary hover:bg-primary/30'
                      : inMonth && !disabled
                      ? 'text-gray-200 hover:bg-dark-surface'
                      : 'text-gray-600'
                  } ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>

          {/* Today shortcut */}
          {!isDisabled(today) && (
            <div className="mt-2 pt-2 border-t border-dark-border/50">
              <button
                type="button"
                onClick={() => { onChange(todayYMD); setOpen(false) }}
                className="w-full text-xs text-gray-400 hover:text-primary py-1 transition-colors"
              >
                Today
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
