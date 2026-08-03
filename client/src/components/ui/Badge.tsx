import { ReactNode } from 'react'

export type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-green-500/15 text-green-400 border-green-500/30',
  danger: 'bg-red-500/15 text-red-400 border-red-500/30',
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  neutral: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

export function Badge({ tone = 'neutral', className = '', children }: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full border ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  )
}
