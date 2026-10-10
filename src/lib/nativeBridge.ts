/**
 * Client for the Android app's message bridge (`window.WiedisyncNative`).
 *
 * The app is a plain WebView around this site. It injects `WiedisyncNative`
 * (WebViewCompat.addWebMessageListener, only on our own origins) for the things
 * a WebView cannot do itself: Web Push (→ UnifiedPush), `blob:` downloads, and
 * the share sheet. In a browser or installed PWA the global is absent and every
 * caller keeps its web path — check `nativeFeatures()` before choosing.
 *
 * Wire format, both directions JSON strings:
 *   web → native   { id, type, ...params }
 *   native → web   { id, ok: true, result } | { id, ok: false, error, message? }
 *                  { event, ... }   — unsolicited, e.g. `push-endpoint`
 * Native can only message a page that has messaged it first, so `hello`
 * (sent once by `nativeFeatures()`) is also what opens the event channel.
 *
 * Presence of the global is a capability signal for UI paths only — any page
 * script can define it, so never trust it for anything security-relevant.
 */
import { captureApiError } from './sentry'

export type NativeFeature = 'saveFile' | 'share' | 'push' | 'systemBars'

/** A UnifiedPush registration, shaped like `PushSubscription.toJSON()`. */
export interface NativePushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Result of `push.state`. */
export interface NativePushState {
  permission: NotificationPermission
  subscription: NativePushSubscription | null
  /** Package of the user's UnifiedPush distributor app, null when none is installed. */
  distributor: string | null
}

/** Rejection of `nativeRequest`: `code` is the native error code, or `'timeout'` / `'unavailable'`. */
export interface NativeBridgeError extends Error {
  code: string
}

type NativeMessage = { data: unknown }

interface NativePort {
  postMessage(message: string): void
  addEventListener?: (type: 'message', listener: (e: NativeMessage) => void) => void
  onmessage?: ((e: NativeMessage) => void) | null
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<number, Pending>()
const eventHandlers = new Map<string, Set<(event: Record<string, unknown>) => void>>()
let nextId = 0
/** The port the shared listener is attached to — one listener per page, however many callers. */
let listeningOn: NativePort | null = null
let features: Promise<string[]> | null = null

function port(): NativePort | null {
  if (typeof window === 'undefined') return null
  const p = (window as { WiedisyncNative?: NativePort }).WiedisyncNative
  return p && typeof p.postMessage === 'function' ? p : null
}

/** True when the page runs inside the native app and its bridge is injected. */
export function hasNativeBridge(): boolean {
  return port() !== null
}

/** `err` came from `nativeRequest` (optionally: with this native error code). */
export function isNativeBridgeError(err: unknown, code?: string): err is NativeBridgeError {
  if (!(err instanceof Error) || err.name !== 'NativeBridgeError') return false
  return code === undefined || (err as NativeBridgeError).code === code
}

function bridgeError(code: string, message?: string): NativeBridgeError {
  const err = new Error(message ? `Native ${code}: ${message}` : `Native ${code}`) as NativeBridgeError
  err.name = 'NativeBridgeError'
  err.code = code
  return err
}

function handleMessage(e: NativeMessage): void {
  // Anything that isn't one of our JSON envelopes is ignored, never thrown on.
  if (typeof e?.data !== 'string') return
  let msg: unknown
  try { msg = JSON.parse(e.data) } catch { return }
  if (!msg || typeof msg !== 'object') return
  const m = msg as Record<string, unknown>

  if (typeof m.id === 'number') {
    const p = pending.get(m.id)
    if (!p) return // late reply to a request that already timed out
    pending.delete(m.id)
    clearTimeout(p.timer)
    if (m.ok === true) p.resolve(m.result)
    else p.reject(bridgeError(
      typeof m.error === 'string' ? m.error : 'unknown',
      typeof m.message === 'string' ? m.message : undefined,
    ))
    return
  }

  if (typeof m.event === 'string') {
    const name = m.event
    eventHandlers.get(name)?.forEach((handler) => {
      // One throwing subscriber must not starve the others.
      try { handler(m) } catch (err) { captureApiError(err, { operation: `nativeBridge.event:${name}` }) }
    })
  }
}

function listen(p: NativePort): void {
  if (listeningOn === p) return
  listeningOn = p
  if (typeof p.addEventListener === 'function') p.addEventListener('message', handleMessage)
  else p.onmessage = handleMessage
}

/**
 * Send one request to the app and await its reply. Rejects with a
 * `NativeBridgeError` carrying the native error code, or `'timeout'`.
 */
export function nativeRequest<T = unknown>(
  type: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<T> {
  const p = port()
  if (!p) return Promise.reject(bridgeError('unavailable'))
  listen(p)
  const id = ++nextId
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(bridgeError('timeout'))
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (result: unknown) => void, reject, timer })
    try {
      // id + type last: a param can never overwrite the envelope.
      p.postMessage(JSON.stringify({ ...params, id, type }))
    } catch (err) {
      clearTimeout(timer)
      pending.delete(id)
      reject(err instanceof Error ? err : bridgeError('unknown', String(err)))
    }
  })
}

/**
 * Subscribe to an unsolicited native event. Events only flow after the page has
 * sent something — call `nativeFeatures()` first. Returns the unsubscribe fn.
 */
export function onNativeEvent<T extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  handler: (event: T) => void,
): () => void {
  const p = port()
  if (p) listen(p)
  let set = eventHandlers.get(name)
  if (!set) eventHandlers.set(name, (set = new Set()))
  const h = handler as (event: Record<string, unknown>) => void
  set.add(h)
  return () => { set.delete(h) }
}

/**
 * What this app build offers, from a `hello` sent once per page load. `[]` in a
 * browser. A failed hello is not cached, so the next caller tries again.
 */
export function nativeFeatures(): Promise<string[]> {
  if (!hasNativeBridge()) return Promise.resolve([])
  if (!features) {
    features = nativeRequest<{ features?: unknown }>('hello')
      .then((r) => (Array.isArray(r?.features) ? r.features.filter((f): f is string => typeof f === 'string') : []))
      .catch((err) => {
        // Every native path falls back to its web path on [] — which inside the
        // WebView mostly means "doesn't work" — so a broken bridge must be visible.
        captureApiError(err, { operation: 'nativeBridge.hello' })
        features = null
        return []
      })
  }
  return features
}

/** `nativeFeatures()` includes `feature` — false in a browser without a round-trip. */
export async function hasNativeFeature(feature: NativeFeature): Promise<boolean> {
  if (!hasNativeBridge()) return false
  return (await nativeFeatures()).includes(feature)
}
