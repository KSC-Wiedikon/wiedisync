/**
 * Paints the Android app's status and navigation bars in the page's own edge
 * colours, so the page runs into them instead of sitting in a brand-blue frame.
 *
 *   top     the page background, or the banner marked `data-system-bar="top"`
 *           while one is the top-most element (impersonation / acting-as)
 *   bottom  the tab bar marked `data-system-bar="bottom"` over the page
 *           background, or the page background on screens without one
 *
 * Sent as `ui.systemBars` {top, bottom: "#rrggbb"} whenever the theme, the
 * rendered tree or the viewport changes. Native side: NativeBridge.kt. A no-op
 * in a browser and in app builds that don't offer `systemBars`.
 */
import { hasNativeFeature, nativeRequest } from './nativeBridge'

/** An sRGB colour, channels 0–255, alpha 0–1. */
export type Rgba = [number, number, number, number]

/** Paint `layers` bottom-first over white; the opaque result as `#rrggbb`. */
export function blendToHex(layers: Rgba[]): string {
  let [r, g, b] = [255, 255, 255]
  for (const [lr, lg, lb, a] of layers) {
    r = lr * a + r * (1 - a)
    g = lg * a + g * (1 - a)
    b = lb * a + b * (1 - a)
  }
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

let ctx: CanvasRenderingContext2D | null | undefined

/**
 * Any CSS colour → Rgba, via a 1×1 canvas: computed styles serialise Tailwind
 * v4 colours as `oklch()` / `color(srgb …)` / `color-mix()` results, not rgb().
 */
function parseColor(css: string): Rgba | null {
  if (ctx === undefined) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!ctx) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = css // an unparseable value is ignored and leaves black
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b, a / 255]
}

function background(el: Element): Rgba | null {
  return parseColor(getComputedStyle(el).backgroundColor)
}

function shown(selector: string): Element | undefined {
  return [...document.querySelectorAll(selector)].find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
}

function edgeColors(): { top: string; bottom: string } | null {
  const page = background(document.body)
  if (!page) return null
  const edge = (selector: string) => {
    const el = shown(selector)
    const own = el ? background(el) : null
    return blendToHex(own ? [page, own] : [page])
  }
  return { top: edge('[data-system-bar="top"]'), bottom: edge('[data-system-bar="bottom"]') }
}

/** Keep the app's system bars in the page's colours. Call once at startup. */
export async function startNativeSystemBars(): Promise<void> {
  if (!(await hasNativeFeature('systemBars'))) return
  let sent = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const sync = () => {
    timer = undefined
    const colors = edgeColors()
    if (!colors) return
    const key = `${colors.top}${colors.bottom}`
    if (key === sent) return
    sent = key
    nativeRequest('ui.systemBars', colors).catch(() => { sent = '' })
  }
  const schedule = (delay = 120) => {
    if (timer === undefined) timer = setTimeout(sync, delay)
  }
  // Theme switches flip `dark` on <html>; re-check once the colours settled.
  new MutationObserver(() => { schedule(); setTimeout(sync, 600) })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  // Tab bar and banners mounting / unmounting (login, desktop width, impersonation).
  new MutationObserver(() => schedule()).observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', () => schedule())
  sync()
}
