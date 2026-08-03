import { Toaster } from 'sonner'

/** The single shared sonner Toaster config for both desktop apps. */
export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: { background: '#1e2130', border: '1px solid #2a2d3e', color: '#fff' },
        duration: 4000,
      }}
      richColors
    />
  )
}
