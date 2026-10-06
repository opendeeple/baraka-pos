// Shown only in `--mode demo` builds (client/.env.demo), so nobody mistakes
// the demo apps for the real store. Clicks pass through it.
export function DemoBadge() {
  if (import.meta.env.VITE_APP_ENV !== 'demo') return null
  return (
    <div className="pointer-events-none fixed left-1/2 top-1 z-[9999] -translate-x-1/2 rounded bg-red-600/90 px-3 py-0.5 text-xs font-bold tracking-widest text-white shadow">
      DEMO
    </div>
  )
}
