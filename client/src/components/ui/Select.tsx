import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
}

interface Placement { top?: number; bottom?: number; left: number; width: number }

export function Select({ value, onChange, options, placeholder, className = '' }: SelectProps) {
  const { t } = useTranslation()
  const effectivePlaceholder = placeholder ?? t('common.selectPlaceholder')
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Outside-click close has to check both the trigger AND the portaled
  // dropdown — the dropdown no longer lives inside wrapRef in the DOM (see
  // the portal note below), so without dropdownRef every option click would
  // register as "outside" and close the menu before its own onClick fires.
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open])

  // The options list is portaled to <body> and positioned with `fixed`
  // coordinates from the trigger's own screen position, instead of being
  // rendered inline with `absolute`. An inline dropdown gets clipped by any
  // scrollable ancestor (a long form inside a modal, a card that scrolls,
  // etc.) — on a touchscreen till that's exactly where this shows up: a
  // product picker a few rows into a scrollable list silently loses its
  // open dropdown behind the container's own scroll boundary instead of
  // floating above it. Re-tracking position during scroll isn't worth the
  // complexity here — closing on scroll (like the outside-click handler
  // already does) keeps this simple, and a dropdown open while its trigger
  // moves underneath it would be confusing anyway.
  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < 240 && r.top > spaceBelow
    setPlacement(
      openUp
        ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width }
        : { top: r.bottom + 4, left: r.left, width: r.width }
    )
    const close = () => setOpen(false)
    // Capture-phase scroll also fires for the options list's own scrolling —
    // on a touchscreen, swiping through a long list closed it mid-swipe, so
    // only scrolling *outside* the dropdown closes it.
    const closeOnOutsideScroll = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return
      close()
    }
    window.addEventListener('scroll', closeOnOutsideScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', closeOnOutsideScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-full flex items-center justify-between bg-dark-card border rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none ${
          open ? 'border-primary' : 'border-dark-border hover:border-gray-600'
        }`}
      >
        <span className={selected ? 'text-white' : 'text-gray-500'}>
          {selected?.label ?? effectivePlaceholder}
        </span>
        <ChevronDown
          size={14}
          className={`text-gray-400 shrink-0 ml-2 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && placement && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-50 bg-dark-card border border-dark-border rounded-lg shadow-2xl overflow-hidden"
          style={{ top: placement.top, bottom: placement.bottom, left: placement.left, width: placement.width }}
        >
          <div className="max-h-56 overflow-y-auto">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm text-left transition-colors ${
                  opt.value === value
                    ? 'text-primary bg-primary/10'
                    : 'text-gray-300 hover:bg-dark-surface hover:text-white'
                }`}
              >
                {opt.label}
                {opt.value === value && <Check size={13} className="text-primary shrink-0 ml-2" />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
