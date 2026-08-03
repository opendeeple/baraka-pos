import { ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** Standard header with an X close button is rendered when a title is given. */
  title?: ReactNode
  /** Tailwind max-width class for the panel, e.g. "max-w-md" (default). */
  maxWidth?: string
  children: ReactNode
  footer?: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, title, maxWidth = 'max-w-md', children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus trap: capture previously-focused element, focus first focusable on
  // open, restore focus on close.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Respect autoFocus inside the panel — only steal focus if nothing inside
    // the dialog already has it.
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }
    return () => {
      restoreRef.current?.focus?.()
    }
  }, [open])

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Escape-to-close + Tab cycling. stopPropagation so Escape does not leak to
  // global handlers (e.g. POSScreen's F5/F4/Escape shortcuts).
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current
        if (!panel) return
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
          .filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (focusables.length === 0) { e.preventDefault(); return }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (!active || !panel.contains(active)) {
          e.preventDefault(); first.focus(); return
        }
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-auto"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`bg-dark-surface border border-dark-border rounded-2xl w-full ${maxWidth} outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between p-5 border-b border-dark-border">
            {typeof title === 'string'
              ? <h2 className="text-white font-semibold">{title}</h2>
              : title}
            <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        )}
        {children}
        {footer !== undefined && (
          <div className="flex gap-3 p-5 pt-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  )
}
