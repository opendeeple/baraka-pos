import { forwardRef, ButtonHTMLAttributes } from 'react'
import { Loader2, LucideIcon } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: LucideIcon
  fullWidth?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary hover:bg-primary-dark text-white font-semibold',
  secondary: 'bg-dark-card border border-dark-border text-gray-400 hover:text-white',
  ghost: 'text-gray-400 hover:text-white hover:bg-dark-card',
  danger: 'bg-red-600 hover:bg-red-700 text-white font-semibold',
  success: 'bg-green-600 hover:bg-green-700 text-white font-semibold',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-[32px] px-3 py-1.5 text-xs rounded-lg gap-1.5',
  md: 'min-h-[40px] px-4 py-2 text-sm rounded-xl gap-2',
  lg: 'min-h-[48px] px-5 py-3 text-base rounded-xl gap-2',
}

const ICON_SIZES: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 17 }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon: Icon, fullWidth = false,
    disabled, className = '', children, type = 'button', ...rest },
  ref
) {
  const iconSize = ICON_SIZES[size]
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center transition-colors active:scale-95',
        'disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth ? 'w-full' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading
        ? <Loader2 size={iconSize} className="animate-spin" />
        : Icon && <Icon size={iconSize} />}
      {children}
    </button>
  )
})
