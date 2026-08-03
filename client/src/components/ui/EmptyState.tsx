import { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'

export function EmptyState({ icon: Icon, title, message, action }: {
  icon: LucideIcon
  title: string
  message?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-600">
      <Icon size={40} className="mb-3 opacity-30" />
      <p className="text-sm">{title}</p>
      {message && <p className="text-xs text-gray-700 mt-1">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
