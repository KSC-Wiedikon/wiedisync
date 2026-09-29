import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDF_RASTER_DEFAULTS, containPreloadErrors, isWorkerError, planPdfRaster } from './pdfRaster'
import { ID_IMAGE_MAX_LONG_EDGE, fitLongEdge, watermarkFontSize } from './idWatermark'
import { forceReloadOnStaleChunk } from './chunkReload'

const A4 = { width: 595, height: 842 }
const CARD = { width: 243, height: 153 } // ID-1 card at 72 dpi

describe('planPdfRaster', () => {
  it('scales a single A4 page so its long edge is 2000px', () => {
    const p = planPdfRaster([A4])
    expect(p.pages).toHaveLength(1)
    expect(p.height).toBe(2000)
    expect(p.width).toBe(Math.floor(595 * (2000 / 842)))
    expect(p.pages[0]).toMatchObject({ x: 0, y: 0 })
    expect(p.omitted).toBe(0)
  })

  it('caps the upscale of tiny card-sized pages', () => {
    const p = planPdfRaster([CARD])
    expect(p.pages[0].scale).toBe(PDF_RASTER_DEFAULTS.maxScale)
    expect(p.width).toBe(243 * 4)
  })

  it('stacks pages vertically with a gap and centres narrower ones', () => {
    const p = planPdfRaster([A4, CARD], { maxTotalPixels: Infinity })
    const [a, b] = p.pages
    expect(b.y).toBe(a.h + PDF_RASTER_DEFAULTS.gap)
    expect(p.height).toBe(a.h + b.h + PDF_RASTER_DEFAULTS.gap)
    expect(p.width).toBe(Math.max(a.w, b.w))
    expect(b.x).toBe(Math.floor((p.width - b.w) / 2))
  })

  it('shrinks uniformly to stay under the total pixel budget', () => {
    const budget = 6_000_000
    const p = planPdfRaster([A4, A4, A4, A4], { maxTotalPixels: budget })
    expect(p.width * p.height).toBeLessThanOrEqual(budget)
    const scales = new Set(p.pages.map((pg) => pg.scale.toFixed(6)))
    expect(scales.size).toBe(1)
    expect(p.pages[0].h).toBeLessThan(2000)
  })

  it('omits pages beyond maxPages and reports how many', () => {
    const p = planPdfRaster([A4, A4, A4, A4, A4, A4])
    expect(p.pages).toHaveLength(4)
    expect(p.omitted).toBe(2)
  })

  it('keeps plan index aligned with page number even for degenerate pages', () => {
    const p = planPdfRaster([{ width: 0, height: 0 }, A4])
    expect(p.pages).toHaveLength(2)
    expect(p.pages.every((pg) => pg.w >= 1 && pg.h >= 1)).toBe(true)
  })

  it('returns an empty plan for no pages', () => {
    expect(planPdfRaster([])).toEqual({ width: 0, height: 0, pages: [], omitted: 0 })
  })
})

describe('watermarkFontSize', () => {
  it('scales with the long edge and never drops below 14px', () => {
    expect(watermarkFontSize(2400, 1200)).toBe(60)
    expect(watermarkFontSize(1600, 1000)).toBe(40)
    expect(watermarkFontSize(100, 50)).toBe(14)
  })
})

describe('fitLongEdge', () => {
  it('bounds a phone photo to WhatsApp size', () => {
    expect(ID_IMAGE_MAX_LONG_EDGE).toBe(1600)
    expect(fitLongEdge(4000, 3000)).toEqual({ w: 1600, h: 1200 })
    expect(fitLongEdge(2350, 3600)).toEqual({ w: 1044, h: 1600 })
    expect(fitLongEdge(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 })
  })

  it('never upscales a small scan', () => {
    expect(fitLongEdge(800, 500)).toEqual({ w: 800, h: 500 })
    expect(fitLongEdge(1, 5000)).toEqual({ w: 1, h: 1600 })
  })
})

describe('isWorkerError', () => {
  it('recognises worker start-up failures only', () => {
    expect(isWorkerError(new Error('Setting up fake worker failed: "x".'))).toBe(true)
    expect(isWorkerError('Worker was terminated')).toBe(true)
    expect(isWorkerError(new Error('Invalid PDF structure.'))).toBe(false)
    expect(isWorkerError(undefined)).toBe(false)
  })
})

describe('containPreloadErrors', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function stubBrowser(onLine = true) {
    const store = new Map<string, string>()
    const replace = vi.fn()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })
    vi.stubGlobal('navigator', { onLine })
    vi.stubGlobal('window', { location: { href: 'https://example.test/games', replace, reload: vi.fn() } })
    return replace
  }

  it('holds the stale-chunk reload while a pdf.js import runs, and releases it after', async () => {
    const replace = stubBrowser()
    await expect(containPreloadErrors(async () => forceReloadOnStaleChunk())).resolves.toBe(false)
    expect(replace).not.toHaveBeenCalled()
    // Released afterwards: an unrelated stale chunk still recovers as before.
    expect(forceReloadOnStaleChunk()).toBe(true)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('releases the hold even when the wrapped call throws', async () => {
    const replace = stubBrowser()
    await expect(containPreloadErrors(async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(forceReloadOnStaleChunk()).toBe(true)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('never reloads while offline', () => {
    const replace = stubBrowser(false)
    expect(forceReloadOnStaleChunk()).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })
})
