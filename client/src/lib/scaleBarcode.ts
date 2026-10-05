// Weighing-scale labels: a label scale prints an EAN-13 whose first digits
// are a store prefix (20–29 by default), then the product's PLU code, then the
// weight, then a check digit — e.g. 22 00123 01250 C = PLU 123, 1.250 kg.
// The till decodes it into product + weight (settings key
// scale_barcode_config, shared by every device). The PLU is the product's
// SKU or barcode as typed in Mahsulotlar (leading zeros don't matter).

export interface ScaleConfig {
  enabled: boolean
  /** Two-digit prefixes the scale is set up with. */
  prefixes: string[]
  /** Digits of the PLU after the prefix (usually 5). */
  pluLength: number
  /** The weight digits are grams when 3 (1250 → 1.250 kg). */
  weightDecimals: number
}

export const SCALE_SETTING_KEY = 'scale_barcode_config'

export const DEFAULT_SCALE_CONFIG: ScaleConfig = {
  enabled: false,
  prefixes: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'],
  pluLength: 5,
  weightDecimals: 3,
}

export function readScaleConfig(raw: string | null | undefined): ScaleConfig {
  if (!raw) return DEFAULT_SCALE_CONFIG
  try {
    const v = JSON.parse(raw) as Partial<ScaleConfig>
    return {
      enabled: Boolean(v.enabled),
      prefixes: Array.isArray(v.prefixes) && v.prefixes.length ? v.prefixes.map(String) : DEFAULT_SCALE_CONFIG.prefixes,
      pluLength: [4, 5, 6].includes(Number(v.pluLength)) ? Number(v.pluLength) : DEFAULT_SCALE_CONFIG.pluLength,
      weightDecimals: [2, 3].includes(Number(v.weightDecimals)) ? Number(v.weightDecimals) : DEFAULT_SCALE_CONFIG.weightDecimals,
    }
  } catch {
    return DEFAULT_SCALE_CONFIG
  }
}

export function ean13CheckDigit(first12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/** PLU + weight (kg) from a scale label, or null when it isn't one. */
export function parseScaleBarcode(code: string, cfg: ScaleConfig): { plu: string; weightKg: number } | null {
  if (!cfg.enabled || !isValidEan13(code)) return null
  const prefix = cfg.prefixes.find((p) => code.startsWith(p))
  if (!prefix) return null
  const plu = code.slice(prefix.length, prefix.length + cfg.pluLength)
  const weightDigits = code.slice(prefix.length + cfg.pluLength, 12)
  if (!plu || !weightDigits) return null
  const weightKg = Number(weightDigits) / 10 ** cfg.weightDecimals
  if (!(weightKg > 0)) return null
  return { plu, weightKg: Math.round(weightKg * 1000) / 1000 }
}

/** The ways a PLU may have been typed into a product's SKU or barcode. */
export function pluVariants(plu: string): string[] {
  const bare = String(Number(plu))
  return Array.from(new Set([plu, bare]))
}
