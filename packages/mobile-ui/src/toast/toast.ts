export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  duration: number
}

type Listener = (item: ToastItem) => void

let nextId = 1
let listener: Listener | null = null
const queue: ToastItem[] = []

/** Wired by ToastProvider on mount; queues fire once a provider attaches. */
export function _attach(fn: Listener): () => void {
  listener = fn
  while (queue.length) fn(queue.shift()!)
  return () => {
    if (listener === fn) listener = null
  }
}

function push(kind: ToastKind, message: string, duration = 2600): void {
  const item: ToastItem = { id: nextId++, kind, message, duration }
  if (listener) listener(item)
  else queue.push(item)
}

/**
 * Imperative toast API (sonner-style so mobile and desktop call sites read
 * alike): `toast.success('Saved')` from anywhere — screens, stores, sync.
 */
export const toast = {
  success: (message: string, duration?: number) => push('success', message, duration),
  error: (message: string, duration?: number) => push('error', message, duration ?? 4000),
  info: (message: string, duration?: number) => push('info', message, duration),
}
