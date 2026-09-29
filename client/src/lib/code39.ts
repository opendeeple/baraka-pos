// Code 39 bar/space widths (N=narrow, W=wide): 5 bars + 4 spaces per
// character, ANSI MH10.8M-1983. Digits only on purpose — badge codes are
// all-digit because a USB scanner "types" what it reads, and letters come out
// wrong when the till's keyboard layout is Russian/Uzbek; digits never do.
const PATTERNS: Record<string, string> = {
  '0': 'NNNWWNWNN', '1': 'WNNWNNNNW', '2': 'NNWWNNNNW', '3': 'WNWWNNNNN',
  '4': 'NNNWWNNNW', '5': 'WNNWWNNNN', '6': 'NNWWWNNNN', '7': 'NNNWNNWNW',
  '8': 'WNNWNNWNN', '9': 'NNWWNNWNN',
  '*': 'NWNNWNWNN', // start/stop
}

/**
 * Scannable Code 39 barcode as an SVG string, sized in millimetres so it
 * prints at a physically predictable size. 0.33mm narrow bars (2.5:1 wide
 * ratio) sit comfortably above what handheld scanners resolve.
 */
export function code39Svg(value: string, narrowMm = 0.33, heightMm = 12): string {
  const wideMm = narrowMm * 2.5
  let x = 0
  const rects: string[] = []
  for (const ch of `*${value}*`) {
    const pattern = PATTERNS[ch]
    if (!pattern) throw new Error(`Code 39: unsupported character "${ch}"`)
    for (let i = 0; i < pattern.length; i++) {
      const w = pattern[i] === 'W' ? wideMm : narrowMm
      // pattern alternates bar, space, bar, ... starting with a bar
      if (i % 2 === 0) rects.push(`<rect x="${x.toFixed(3)}" width="${w.toFixed(3)}" height="${heightMm}"/>`)
      x += w
    }
    x += narrowMm // inter-character gap
  }
  const width = (x - narrowMm).toFixed(3)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${heightMm}mm" viewBox="0 0 ${width} ${heightMm}" shape-rendering="crispEdges" fill="#000">${rects.join('')}</svg>`
}

/** Random all-digit badge code (see PATTERNS for why digits only). */
export function generateBadgeCode(length = 10): string {
  const digits = crypto.getRandomValues(new Uint32Array(length))
  return Array.from(digits, (d) => String(d % 10)).join('')
}
