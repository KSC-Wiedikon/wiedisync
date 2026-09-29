/**
 * On-device PDF → canvas rasteriser for E2EE identity documents (ShowIdsView).
 *
 * Why: an installed PWA on a phone cannot show a PDF in an <iframe> (Android
 * Chrome has no in-frame viewer, iOS is flaky), so a coach at the hall got a
 * "blocked" box instead of the ID. PDFs are now drawn to pixels with pdf.js and
 * watermarked exactly like photos.
 *
 * Constraints this file honours:
 * - The plaintext never leaves the device: pdf.js gets the bytes in memory
 *   (`data`), nothing is fetched or logged, and the worker is destroyed after
 *   every document.
 * - OFFLINE: halls have no signal, there is no caching service worker and
 *   index.html is no-store — so the app itself only runs offline inside a page
 *   lifetime that STARTED online. `warmPdfRaster()` therefore has to run in
 *   that same lifetime, while online: it resolves the lazy pdf.js chunk into
 *   the module map and reads the worker script into an in-memory blob: URL, so
 *   a later render needs no network at all. Do NOT count on the HTTP cache: the
 *   pdf chunk imports Vite's preload helper from the entry chunk, so its hash
 *   changes on (nearly) every deploy. Warm-up points: app boot + every
 *   'online' event when this device holds a cached PDF ID
 *   (`armPdfRasterWarmup`, main.tsx), Show IDs page open, and "Download for
 *   offline" (which tells the coach if it failed).
 * - A failed lazy import must NEVER reload the page: Vite fires
 *   `vite:preloadError` first, and main.tsx answers that with a stale-chunk
 *   reload — offline that lands on the browser's offline page. Every pdf.js
 *   import (the chunk, and pdf.js's own fake-worker import) runs inside
 *   `containPreloadErrors`, which holds that reload so the error reaches our
 *   catch and the frame fallback instead.
 * - CSP: `script-src 'self'` (no eval — pdf.js v6 has no eval path at all),
 *   `worker-src 'self' blob:` (the worker runs from our own blob: URL), no
 *   wasm (`useWasm: false`, CSP carries no 'wasm-unsafe-eval'), no CDN.
 * - The legacy build: it ships core-js polyfills for the very new builtins the
 *   modern build calls natively (Map#getOrInsertComputed …), which older
 *   phones' browsers lack.
 */
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { Rect } from './idWatermark'
import { hasCachedPdfDocuments } from './e2eeStore'
import { withStaleChunkReloadHeld } from './chunkReload'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

export interface PageSize {
  width: number
  height: number
}

export interface PlannedPage extends Rect {
  scale: number
}

export interface RasterPlan {
  width: number
  height: number
  pages: PlannedPage[]
  /** Pages beyond `maxPages` that are not drawn. */
  omitted: number
}

export interface RasterPlanOptions {
  /** Pages drawn at most — an ID is 1–2 pages; anything past this is omitted. */
  maxPages?: number
  /** Long edge of one page, px. Bounds memory on phones. */
  maxLongEdge?: number
  /** Never upscale beyond this (tiny card-sized PDFs). */
  maxScale?: number
  /** Area of the stacked canvas, px² — stays below iOS's ~16.7M canvas limit. */
  maxTotalPixels?: number
  /** Vertical gap between stacked pages, px. */
  gap?: number
}

export const PDF_RASTER_DEFAULTS: Required<RasterPlanOptions> = {
  maxPages: 4,
  maxLongEdge: 2000,
  maxScale: 4,
  maxTotalPixels: 12_000_000,
  gap: 16,
}

/**
 * Pure layout: given every page's size at scale 1 (PDF points), decide how
 * large each page is drawn and where, stacked vertically and centred into ONE
 * image so the referee sees the whole document on one card.
 */
export function planPdfRaster(sizes: PageSize[], opts: RasterPlanOptions = {}): RasterPlan {
  const o = { ...PDF_RASTER_DEFAULTS, ...opts }
  // No filtering: plan index i must stay page i+1 for the renderer.
  const used = sizes.slice(0, Math.max(0, o.maxPages)).map((s) => ({
    width: Math.max(1, s.width || 0),
    height: Math.max(1, s.height || 0),
  }))
  const omitted = Math.max(0, sizes.length - Math.max(0, o.maxPages))
  if (used.length === 0) return { width: 0, height: 0, pages: [], omitted }

  const scales = used.map((s) => Math.min(o.maxLongEdge / Math.max(s.width, s.height), o.maxScale))
  const measure = (k: number) => {
    const dims = used.map((s, i) => ({
      w: Math.max(1, Math.floor(s.width * scales[i] * k)),
      h: Math.max(1, Math.floor(s.height * scales[i] * k)),
    }))
    const width = Math.max(...dims.map((d) => d.w))
    const height = dims.reduce((sum, d) => sum + d.h, 0) + o.gap * (dims.length - 1)
    return { dims, width, height }
  }

  let k = 1
  let m = measure(k)
  if (m.width * m.height > o.maxTotalPixels) {
    k = Math.sqrt(o.maxTotalPixels / (m.width * m.height))
    m = measure(k)
    // Flooring + the fixed gap can leave it a hair over; shave until it fits.
    while (m.width * m.height > o.maxTotalPixels && k > 0.01) {
      k *= 0.98
      m = measure(k)
    }
  }

  let y = 0
  const pages = m.dims.map((d, i) => {
    const page: PlannedPage = { x: Math.floor((m.width - d.w) / 2), y, w: d.w, h: d.h, scale: scales[i] * k }
    y += d.h + o.gap
    return page
  })
  return { width: m.width, height: m.height, pages, omitted }
}

let pdfjsPromise: Promise<PdfJs> | null = null
let workerReady: Promise<void> | null = null

/**
 * Run `fn` with the stale-chunk reload held (chunkReload.ts): a failed pdf.js
 * import — the chunk, or pdf.js's own fake-worker `import()` — then rejects
 * into our catch and the frame fallback, instead of main.tsx's
 * `vite:preloadError` handler reloading the page (offline: the browser's
 * offline page, the app gone).
 */
export function containPreloadErrors<T>(fn: () => Promise<T>): Promise<T> {
  return withStaleChunkReloadHeld(fn)
}

function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = containPreloadErrors(() => import('pdfjs-dist/legacy/build/pdf.mjs'))
      .then((mod) => {
        // Defensive: a cancelled preloadError makes Vite's helper resolve undefined.
        if (!(mod as PdfJs | undefined)?.getDocument) throw new Error('pdf.js chunk unavailable')
        return mod
      })
      .catch((err) => {
        pdfjsPromise = null // offline and never warmed — let a later attempt retry
        throw err
      })
  }
  return pdfjsPromise
}

function prepareWorker(pdfjs: PdfJs): Promise<void> {
  if (!workerReady) {
    workerReady = (async () => {
      try {
        // The Vite dev server serves the worker with an injected `/@vite/client`
        // import, which cannot resolve from a blob: URL. Dev is online anyway.
        if (import.meta.env.DEV) {
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
          return
        }
        // Hold the worker script in memory: a blob: URL keeps working with no
        // signal, where the hashed asset URL would need the network. Library
        // code, not user data — never revoked.
        const res = await fetch(workerUrl)
        if (!res.ok) throw new Error(`worker ${res.status}`)
        const blob = new Blob([await res.arrayBuffer()], { type: 'text/javascript' })
        pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob)
      } catch (err) {
        // Keep the asset URL as a fallback, but let the next warm-up retry the blob.
        pdfjs.GlobalWorkerOptions.workerSrc ||= workerUrl
        workerReady = null
        throw err
      }
    })()
  }
  return workerReady
}

/**
 * Load pdf.js + its worker into memory. Call while online; safe to call often.
 * Resolves true when a later render will work fully offline.
 */
export async function warmPdfRaster(): Promise<boolean> {
  try {
    await prepareWorker(await loadPdfjs())
    return true
  } catch {
    return false
  }
}

/**
 * App-boot hook (main.tsx): when this device holds a cached PDF ID, warm pdf.js
 * now and on every 'online' event until it succeeds — so a coach whose app was
 * opened online (the only way it runs offline at all) can render it in the hall.
 */
export function armPdfRasterWarmup(): void {
  if (typeof window === 'undefined') return
  let done = false
  const tryWarm = async () => {
    if (done || navigator.onLine === false) return
    if (!(await hasCachedPdfDocuments())) return
    if (await warmPdfRaster()) {
      done = true
      window.removeEventListener('online', tryWarm)
    }
  }
  window.addEventListener('online', tryWarm)
  void tryWarm()
}

export interface RasterResult {
  canvas: HTMLCanvasElement
  pageCount: number
  omitted: number
}

type Decorate = (ctx: CanvasRenderingContext2D, rect: Rect) => void
type PdfWorkerInstance = InstanceType<PdfJs['PDFWorker']>

/** A worker that failed to start (CSP, blocked blob:, fake-worker import). */
export function isWorkerError(err: unknown): boolean {
  return /worker/i.test(err instanceof Error ? err.message : String(err ?? ''))
}

/**
 * One pdf.js worker shared by every PDF in a reveal, so the 1.3 MB worker
 * script is parsed once, not once per player. Each document is still destroyed
 * after rendering (the worker drops its bytes); `close()` ends the worker.
 */
export class PdfRasterSession {
  private worker: PdfWorkerInstance | null = null

  /**
   * Render a PDF (plaintext bytes, in memory) to ONE stacked canvas. `decorate`
   * runs once per page on the stacked canvas — used to burn the watermark per
   * page. The caller owns the returned canvas. Throws if pdf.js cannot load or
   * the document cannot be parsed; the caller falls back.
   */
  rasterise(data: Uint8Array, decorate?: Decorate, opts: RasterPlanOptions = {}): Promise<RasterResult> {
    return containPreloadErrors(async () => {
      const pdfjs = await loadPdfjs()
      // Not being warmed is not fatal online: the asset URL still works.
      try { await prepareWorker(pdfjs) } catch { /* workerSrc falls back to the asset URL */ }
      try {
        return await this.render(pdfjs, data, decorate, opts)
      } catch (err) {
        this.dropWorker()
        // A browser that refuses the blob: worker (old WebKit applies script-src
        // to workers) — retry once from the same-origin asset, which
        // `script-src 'self'` allows. Needs the network, hence online only.
        const src = pdfjs.GlobalWorkerOptions.workerSrc
        if (!isWorkerError(err) || !src.startsWith('blob:') || navigator.onLine === false) throw err
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        return await this.render(pdfjs, data, decorate, opts)
      }
    })
  }

  close(): void {
    this.dropWorker()
  }

  private dropWorker(): void {
    try { this.worker?.destroy() } catch { /* already gone */ }
    this.worker = null
  }

  private async render(pdfjs: PdfJs, data: Uint8Array, decorate: Decorate | undefined, opts: RasterPlanOptions): Promise<RasterResult> {
    if (!this.worker) this.worker = new pdfjs.PDFWorker()
    const task = pdfjs.getDocument({
      // pdf.js transfers the buffer to its worker — hand it a copy so the
      // caller's bytes stay usable for the fallback path.
      data: data.slice(),
      worker: this.worker,
      useWasm: false,
      useWorkerFetch: false,
      enableXfa: false,
      stopAtErrors: false,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    })
    try {
      const doc = await task.promise
      const maxPages = opts.maxPages ?? PDF_RASTER_DEFAULTS.maxPages
      const count = Math.min(doc.numPages, maxPages)
      const sizes: PageSize[] = []
      for (let i = 1; i <= count; i++) {
        const vp = (await doc.getPage(i)).getViewport({ scale: 1 })
        sizes.push({ width: vp.width, height: vp.height })
      }
      const plan = planPdfRaster(sizes, { ...opts, maxPages })
      const omitted = plan.omitted + Math.max(0, doc.numPages - count)
      if (plan.pages.length === 0) throw new Error('empty pdf')

      const canvas = document.createElement('canvas')
      canvas.width = plan.width
      canvas.height = plan.height
      try {
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, plan.width, plan.height)

        for (let i = 0; i < plan.pages.length; i++) {
          const p = plan.pages[i]
          const page = await doc.getPage(i + 1)
          const viewport = page.getViewport({ scale: p.scale })
          const pc = document.createElement('canvas')
          pc.width = p.w
          pc.height = p.h
          try {
            await page.render({ canvas: pc, viewport }).promise
            ctx.drawImage(pc, p.x, p.y, p.w, p.h)
          } finally {
            pc.width = 0
            pc.height = 0
            page.cleanup()
          }
          decorate?.(ctx, p)
        }
      } catch (err) {
        // Only a successful return hands the canvas over — free the (up to
        // ~48 MB) backing store now, or iOS counts it against the next PDF.
        canvas.width = 0
        canvas.height = 0
        throw err
      }
      return { canvas, pageCount: doc.numPages, omitted }
    } finally {
      // Tears down the document (the shared worker drops its bytes); the worker
      // itself is ours, so pdf.js leaves it running for the next PDF.
      await task.destroy()
    }
  }
}

/** One-shot convenience: rasterise a single PDF with its own short-lived worker. */
export async function rasterisePdf(data: Uint8Array, decorate?: Decorate, opts: RasterPlanOptions = {}): Promise<RasterResult> {
  const session = new PdfRasterSession()
  try {
    return await session.rasterise(data, decorate, opts)
  } finally {
    session.close()
  }
}
