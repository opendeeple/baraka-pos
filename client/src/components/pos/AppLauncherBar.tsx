import { useState } from 'react'

export interface PosApp {
  id: string
  name: string
  url: string
  color: string
}

export const DEFAULT_APPS: PosApp[] = [
  { id: 'click', name: 'CLICK', url: 'https://my.click.uz', color: '#1DA1F2' },
]

export const APPS_STORAGE_KEY = 'pos_apps'

export function loadApps(): PosApp[] {
  try {
    const raw = localStorage.getItem(APPS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : DEFAULT_APPS
  } catch {
    return DEFAULT_APPS
  }
}

export function saveApps(apps: PosApp[]) {
  localStorage.setItem(APPS_STORAGE_KEY, JSON.stringify(apps))
}

interface Props {
  onOpenApp: (app: PosApp) => void
}

export default function AppLauncherBar({ onOpenApp }: Props) {
  const [apps] = useState<PosApp[]>(loadApps)

  return (
    <div className="w-14 bg-dark-surface border-r border-dark-border flex flex-col items-center py-3 gap-2 shrink-0 overflow-y-auto overflow-x-hidden">
      {apps.map((app) => (
        <div key={app.id} className="relative group">
          <button
            title={app.name}
            onClick={() => onOpenApp(app)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold transition-transform active:scale-95 select-none"
            style={{ backgroundColor: app.color }}
          >
            {app.name.slice(0, 2).toUpperCase()}
          </button>
          <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-dark-card border border-dark-border text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
            {app.name}
          </div>
        </div>
      ))}
    </div>
  )
}
