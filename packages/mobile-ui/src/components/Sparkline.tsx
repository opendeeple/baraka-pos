import { View } from 'react-native'
import Svg, { Polyline } from 'react-native-svg'
import { useTheme } from '../theme/ThemeProvider'

export interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  strokeWidth?: number
}

/** Minimal trend line for KPI tiles — no axes, no labels, just shape. */
export function Sparkline({ data, width = 72, height = 24, color, strokeWidth = 2 }: SparklineProps) {
  const theme = useTheme()
  if (data.length < 2) return <View style={{ width, height }} />

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pad = strokeWidth
  const stepX = (width - pad * 2) / (data.length - 1)
  const points = data
    .map((v, i) => {
      const x = pad + i * stepX
      const y = pad + (1 - (v - min) / span) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points}
        fill="none"
        stroke={color ?? theme.primary}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
