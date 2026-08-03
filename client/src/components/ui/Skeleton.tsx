import { CSSProperties } from 'react'

export function Skeleton({ width, height = 14, className = '' }: {
  width?: number | string
  height?: number | string
  className?: string
}) {
  const style: CSSProperties = { width, height }
  return <div className={`animate-pulse bg-dark-card rounded ${className}`} style={style} />
}

/** Placeholder table row — renders `cols` cells with pulsing blocks. */
export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton width={i === 0 ? '70%' : '50%'} />
        </td>
      ))}
    </tr>
  )
}
