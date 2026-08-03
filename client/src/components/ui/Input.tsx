import { forwardRef, InputHTMLAttributes, ReactNode } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  left?: ReactNode
  right?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, left, right, className = '', ...rest },
  ref
) {
  const input = (
    <input
      ref={ref}
      className={[
        'w-full bg-dark-card border rounded-lg text-white text-sm placeholder-gray-500',
        'focus:outline-none focus:border-primary',
        error ? 'border-red-500' : 'border-dark-border',
        left ? 'pl-9' : 'pl-3',
        right ? 'pr-9' : 'pr-3',
        'py-2.5',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    />
  )

  return (
    <div>
      {label && <label className="text-xs text-gray-400 mb-1 block">{label}</label>}
      {left || right ? (
        <div className="relative">
          {left && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 flex items-center">
              {left}
            </span>
          )}
          {input}
          {right && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 flex items-center">
              {right}
            </span>
          )}
        </div>
      ) : input}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
})
