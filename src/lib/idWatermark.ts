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

/**
 * Long edge of an ID document, px — WhatsApp's standard image size. Stored documents are
 * encoded at it (idShrink.ts) and Show IDs draws at it. A phone camera crop is 6–12 MP;
 * drawn and re-encoded at full size it took seconds per player on a phone. 1600 px is
 * still ~475 dpi across an ID card, more than any phone screen shows.
 */
export const ID_IMAGE_MAX_LONG_EDGE = 1600

/** Scale `w × h` down so the long edge fits `max` — never up. */
export function fitLongEdge(w: number, h: number, max: number = ID_IMAGE_MAX_LONG_EDGE): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/**
 * Font size for a document region — scales with the region, never unreadably small.
 * /40 (was /24, 2026-09-29): the mark must survive a screenshot, not hide the ID from the
 * referee — at 1600 px that is 40 px text.
 */
export function watermarkFontSize(w: number, h: number): number {
  return Math.max(14, Math.round(Math.max(w, h) / 40))
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
  // Lighter than the first version (2026-09-29): fainter, thinner, rows further apart —
  // still in the pixels of any screenshot, no longer in the referee's way.
  ctx.lineWidth = Math.max(1, fs / 16)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.26)'
  const diag = Math.hypot(w, h)
  for (let ly = -diag / 2; ly <= diag / 2; ly += fs * 5) {
    ctx.strokeText(label, 0, ly, diag)
    ctx.fillText(label, 0, ly, diag)
  }
  ctx.restore()
}

/**
 * Encode a canvas to a blob URL (caller owns + revokes it), then free the
 * canvas. PNG by default (keeps alpha); pass 'image/jpeg' for anything opaque —
 * photo IDs and rasterised scans alike. PNG of photographic content is several
 * times slower to encode on a phone and ~15× larger (an 8 MP ID: ~15 MB).
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
