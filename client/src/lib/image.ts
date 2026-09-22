/**
 * Resizes+compresses an image data: URI via an offscreen <canvas> — pure
 * browser APIs, no native image-processing dependency (this project already
 * spent a full session fighting native-module packaging for the printer
 * path; product photos don't need to reopen that). Product images are
 * stored directly in products.image_url as a data: URI (see ProductsScreen),
 * so keeping them small matters for both DB row size and sync payloads.
 */
export function resizeImageDataUrl(dataUrl: string, maxDim = 400, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not supported')); return }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = dataUrl
  })
}
