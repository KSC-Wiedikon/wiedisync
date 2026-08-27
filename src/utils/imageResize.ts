// ── Client-side image downscaling ────────────────────────────────────────────
//
// A phone or a darktable export routinely produces a 5–15 MB JPEG. A profile
// photo is rendered at 64–128 px, so shipping the original is pure waste — and
// the 5 MB picker cap turned a completely ordinary camera file into a *silent*
// rejection (the error paints far below the fold of a long form).
//
// So: shrink first, reject only what still cannot fit. The original is returned
// untouched whenever re-encoding would be pointless or lossy for no gain:
// already small enough, animated GIF/SVG, or a re-encode that came out bigger.

/** Longest edge of the downscaled image, in CSS pixels. */
const DEFAULT_MAX_EDGE = 1600
/** Target size; quality steps down until the encode fits (or steps run out). */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const QUALITY_STEPS = [0.85, 0.7, 0.55]

/** Formats a canvas can re-encode without destroying the file (GIF loses its animation, SVG its vectors). */
const RESIZABLE = /^image\/(jpeg|png|webp|heic|heif)$/i

export interface DownscaleOptions {
  maxEdge?: number
  maxBytes?: number
}

/** Decode to a bitmap, honouring EXIF orientation. Falls back to `<img>` where `createImageBitmap` cannot take the blob (older Safari, HEIC). */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // `<img>` applies EXIF orientation itself, so the fallback needs no flag.
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/** Duck-typed rather than `instanceof ImageBitmap` — the class is absent in the node test env, where `instanceof` on an undefined global throws. */
function isBitmap(src: ImageBitmap | HTMLImageElement): src is ImageBitmap {
  return typeof (src as ImageBitmap).close === 'function'
}

function dimensionsOf(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return isBitmap(src)
    ? { w: src.width, h: src.height }
    : { w: src.naturalWidth, h: src.naturalHeight }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/**
 * Returns a JPEG no larger than `maxEdge` on its longest side and, where the
 * encoder can manage it, under `maxBytes`.
 *
 * Never throws: any decode/encode failure returns the original file, so the
 * caller's own size + type validation stays the single gate.
 */
export async function downscaleImage(file: File, opts: DownscaleOptions = {}): Promise<File> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  if (!RESIZABLE.test(file.type)) return file

  let src: ImageBitmap | HTMLImageElement
  try {
    src = await decode(file)
  } catch {
    return file
  }

  try {
    const { w, h } = dimensionsOf(src)
    if (!w || !h) return file
    // Already small in both senses — re-encoding would only cost quality.
    if (file.size <= maxBytes && Math.max(w, h) <= maxEdge) return file

    const scale = Math.min(1, maxEdge / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    // A transparent PNG flattens onto white rather than black once it becomes JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height)

    let best: Blob | null = null
    for (const quality of QUALITY_STEPS) {
      const blob = await toBlob(canvas, quality)
      if (!blob) break
      best = blob
      if (blob.size <= maxBytes) break
    }
    // A re-encode that grew the file (small source, noisy image) is not an improvement.
    if (!best || best.size >= file.size) return file

    const name = file.name.replace(/\.[^./\\]+$/, '') + '.jpg'
    return new File([best], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  } finally {
    if (isBitmap(src)) src.close()
  }
}
