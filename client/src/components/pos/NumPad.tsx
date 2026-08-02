import { Delete } from 'lucide-react'

interface Props {
  value: string
  onChange: (val: string) => void
  maxDecimals?: number
  label?: string
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'] as const

function formatDisplay(raw: string): string {
  const [intPart, decPart] = raw.split('.')
  const formatted = Number(intPart).toLocaleString('en-US')
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted
}

export function NumPad({ value, onChange, maxDecimals = 2, label }: Props) {
  const handleKey = (key: string) => {
    if (key === '⌫') {
      onChange(value.length > 1 ? value.slice(0, -1) : '0')
      return
    }
    if (key === '.') {
      if (value.includes('.')) return
      onChange(value + '.')
      return
    }
    const next = value === '0' ? key : value + key
    const parts = next.split('.')
    if (parts[1] && parts[1].length > maxDecimals) return
    onChange(next)
  }

  return (
    <div className="select-none">
      {label && (
        <p className="text-gray-400 text-sm text-center mb-2">{label}</p>
      )}
      {/* Display */}
      <div className="text-right text-white text-4xl font-bold px-4 py-4 bg-dark-surface rounded-xl mb-3 tracking-wider min-h-[72px] flex items-center justify-end">
        {formatDisplay(value || '0')}
      </div>
      {/* Keys */}
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => handleKey(k)}
            className={`
              h-[72px] rounded-xl text-xl font-bold transition-all active:scale-95
              ${k === '⌫'
                ? 'bg-red-500/20 text-red-400 active:bg-red-500/40'
                : 'bg-dark-card text-white active:bg-dark-surface border border-dark-border/50'
              }
            `}
          >
            {k === '⌫' ? <Delete size={22} className="mx-auto" /> : k}
          </button>
        ))}
      </div>
    </div>
  )
}
