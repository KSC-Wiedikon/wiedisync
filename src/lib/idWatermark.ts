/**
 * The use-restriction watermark burned INTO decrypted identity documents
 * (ShowIdsModal). One implementation for photos and rasterised PDFs, so a
 * screenshot of either carries the same "club · purpose · who · when" in its
 * pixels.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Font size for a document region — scales with the region, never unreadably small. */
export function watermarkFontSize(w: number, h: number): number {
  return Math.max(16, Math.round(Math.max(w, h) / 24))
}

/**
 * Diagonal, repeated, light-on-dark-stroked — readable on any document without
 * making the document itself unreadable to the referee. Drawn inside `rect`
 * only (clipped), so each page of a stacked PDF gets its own full pattern.
 */
export function burnWatermark(ctx: CanvasRenderingContext2D, rect: Rect, label: string): void {
  const { x, y, w, h } = rect
  if (!w || !h) return
  const fs = watermarkFontSize(w, h)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.translate(x + w / 2, y + h / 2)
  ctx.rotate(-Math.PI / 9)
  ctx.font = `bold ${fs}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(1, fs / 12)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
  const diag = Math.hypot(w, h)
  for (let ly = -diag / 2; ly <= diag / 2; ly += fs * 3.5) {
    ctx.strokeText(label, 0, ly, diag)
    ctx.fillText(label, 0, ly, diag)
  }
  ctx.restore()
}

/**
 * Encode a canvas to a blob URL (caller owns + revokes it), then free the
 * canvas. PNG by default (keeps a photo's alpha); pass 'image/jpeg' for opaque
 * rasterised scans — several times faster to encode on a phone and ~10× smaller.
 */
export async function canvasToObjectUrl(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality?: number,
): Promise<string | null> {
  try {
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
    return out ? URL.createObjectURL(out) : null
  } finally {
    // Zeroing the size drops the backing store now instead of at GC — phones
    // run out of canvas memory quickly with several ID scans in a row.
    canvas.width = 0
    canvas.height = 0
  }
}
