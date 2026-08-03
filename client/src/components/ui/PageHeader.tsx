import { ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="shrink-0 px-6 py-4 border-b border-dark-border bg-dark-surface flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-white">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
