import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '../ui'
import { parseStickerSize } from '../../lib/labels'

interface Props {
  /** "<width>x<height>" in mm, or one of `extra`'s values. */
  value: string
  onChange: (value: string) => void
  presets: string[]
  /** Non-sticker choices listed by their own label (e.g. the badge's ID card). */
  extra?: Record<string, string>
}

const CUSTOM = '__custom__'
const INPUT_CLS = 'w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary'

/**
 * Sticker size: a preset, or "Custom" with width × height typed in mm — label
 * stock comes in many sizes (100×60, 60×40, …), not just the presets.
 */
export function StickerSizeSelect({ value, onChange, presets, extra = {} }: Props) {
  const { t } = useTranslation()
  const isPreset = presets.includes(value) || value in extra
  const [custom, setCustom] = useState(!isPreset)
  const dims = parseStickerSize(value)
  const [w, setW] = useState(dims ? String(dims.w) : '')
  const [h, setH] = useState(dims ? String(dims.h) : '')

  // A value set from outside (e.g. settings loading) re-syncs the fields.
  useEffect(() => {
    const d = parseStickerSize(value)
    if (d) { setW(String(d.w)); setH(String(d.h)) }
    if (!presets.includes(value) && !(value in extra)) setCustom(true)
  }, [value])

  function pick(v: string) {
    if (v === CUSTOM) { setCustom(true); return }
    setCustom(false)
    onChange(v)
  }

  function edit(nextW: string, nextH: string) {
    setW(nextW); setH(nextH)
    const size = `${Number(nextW)}x${Number(nextH)}`
    if (parseStickerSize(size)) onChange(size)
  }

  const invalid = custom && !parseStickerSize(`${Number(w)}x${Number(h)}`)

  return (
    <div className="space-y-2">
      <Select
        value={custom ? CUSTOM : value}
        onChange={pick}
        options={[
          ...Object.entries(extra).map(([v, label]) => ({ value: v, label })),
          ...presets.map((k) => ({ value: k, label: `${k.replace('x', ' × ')} mm` })),
          { value: CUSTOM, label: t('labels.customSize') },
        ]}
      />
      {custom && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input type="number" min={15} max={200} step={1} value={w} placeholder={t('labels.width')}
              onChange={(e) => edit(e.target.value, h)} className={INPUT_CLS} />
            <span className="text-gray-500">×</span>
            <input type="number" min={15} max={200} step={1} value={h} placeholder={t('labels.height')}
              onChange={(e) => edit(w, e.target.value)} className={INPUT_CLS} />
            <span className="text-gray-500 text-sm">mm</span>
          </div>
          <p className={`text-xs ${invalid ? 'text-red-400' : 'text-gray-500'}`}>{t('labels.customSizeHint')}</p>
        </div>
      )}
    </div>
  )
}
