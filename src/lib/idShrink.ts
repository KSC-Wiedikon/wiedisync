/**
 * Identity documents at WhatsApp size (2026-09-29): long edge ≤ 1600 px, JPEG 0.8 — about
 * 150–300 KB, where a camera crop was 1–2.5 MB. Show IDs downloads a whole squad at once,
 * often on a hall's mobile signal, so the stored size is the download time.
 *
 * Used at upload (the crop editor, and PDFs, which become a JPEG so the hall never needs
 * pdf.js) and for documents already stored — re-encoded by a device that holds a key, since
 * the server never sees the plaintext (`recompress`, identityUpload.ts).
 */
import { fitLongEdge, ID_IMAGE_MAX_LONG_EDGE } from './idWatermark'
import { safeBlobType } from '../utils/filePreviewKind'

export const ID_JPEG_QUALITY = 0.8

/** Stored documents above this are re-encoded. A 1600 px JPEG at 0.8 lands well below it. */
export const ID_SHRINK_ABOVE_BYTES = 450 * 1024

/** Should a stored document be re-encoded? PDFs always: as a JPEG the hall needs no pdf.js. */
export function needsShrink(size: number | null | undefined, mime: string | null | undefined): boolean {
  if (mime === 'application/pdf') return true
  return (size ?? 0) > ID_SHRINK_ABOVE_BYTES
}

function encodeJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => {
    // Drop the backing store now, not at GC — phones run short of canvas memory.
    canvas.width = 0
    canvas.height = 0
    resolve(b)
  }, 'image/jpeg', ID_JPEG_QUALITY))
}

/**
 * Re-encode a plaintext ID (photo or PDF) at WhatsApp size. null when this browser cannot
 * decode it (an iPhone HEIC on Android, a PDF pdf.js rejects) — the caller keeps the original.
 */
export async function shrinkIdDocument(plain: Uint8Array, mime: string): Promise<Blob | null> {
  if (mime === 'application/pdf') {
    try {
      // Lazy, like every pdf.js entry point (main.tsx): keeps it out of the main chunk.
      const { rasterisePdf } = await import('./pdfRaster')
      // Each page capped at the same long edge and stacked — the stack itself is not
      // shrunk again, or a two-page ID would come out at half size per page.
      const { canvas } = await rasterisePdf(plain, undefined, { maxLongEdge: ID_IMAGE_MAX_LONG_EDGE })
      return await encodeJpeg(canvas)
    } catch {
      return null
    }
  }
  const url = URL.createObjectURL(new Blob([plain as BlobPart], { type: safeBlobType(mime) }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('not decodable'))
      img.src = url
    })
    if (!img.naturalWidth || !img.naturalHeight) return null
    const { w, h } = fitLongEdge(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // White bed: JPEG has no alpha, and a transparent PNG would turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return await encodeJpeg(canvas)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
