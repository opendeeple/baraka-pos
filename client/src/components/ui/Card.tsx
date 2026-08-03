import { HTMLAttributes } from 'react'

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-dark-surface border border-dark-border rounded-xl p-4 ${className}`}
      {...rest}
    />
  )
}
