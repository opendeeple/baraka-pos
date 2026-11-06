export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  duration: number
}

/*
 * Toasts live in one shared list; every host (the root ToastProvider plus
 * one inside each Sheet/Dialog Modal) subscribes, but only the TOPMOST
 * mounted host draws them. A Modal is a separate native window, so a toast
 * drawn by the root provider was hidden behind any open sheet — form
 * validation errors were invisible and buttons looked dead. When a sheet
 * closes, its host unmounts and the host below picks the same toasts up,
 * so "close sheet, then toast.success()" still shows.
 */

let nextId = 1
let items: ToastItem[] = []
const subscribers = new Set<() => void>()
const hostStack: number[] = []
let nextHostId = 1

function emit() {
  subscribers.forEach((fn) => fn())
}

export function _getItems(): ToastItem[] {
  return items
}

export function _subscribe(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** Registers a host; returns its id and an unregister function. */
export function _registerHost(): { id: number; unregister: () => void } {
  const id = nextHostId++
  hostStack.push(id)
  emit()
  return {
    id,
    unregister: () => {
      const i = hostStack.indexOf(id)
      if (i >= 0) hostStack.splice(i, 1)
      emit()
    },
  }
}

export function _isTopHost(id: number): boolean {
  return hostStack[hostStack.length - 1] === id
}

function push(kind: ToastKind, message: string, duration = 2600): void {
  const item: ToastItem = { id: nextId++, kind, message, duration }
  items = [...items.slice(-2), item]
  emit()
  setTimeout(() => {
    items = items.filter((t) => t.id !== item.id)
    emit()
  }, duration)
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
