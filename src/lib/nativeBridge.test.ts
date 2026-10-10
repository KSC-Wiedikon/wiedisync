import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sentry', () => ({ captureApiError: vi.fn() }))

type Bridge = typeof import('./nativeBridge')
type Sent = { id: number; type: string } & Record<string, unknown>

/**
 * Stand-in for the injected `window.WiedisyncNative`. `reply` answers each
 * request (null = never answer); `emit` pushes a raw message like the app does.
 */
function installFakeBridge(reply: (msg: Sent) => unknown = () => null) {
  const listeners = new Set<(e: { data: unknown }) => void>()
  const sent: Sent[] = []
  const emit = (data: unknown) => listeners.forEach((l) => l({ data: typeof data === 'string' ? data : JSON.stringify(data) }))
  const native = {
    postMessage(raw: string) {
      const msg = JSON.parse(raw) as Sent
      sent.push(msg)
      const r = reply(msg)
      if (r) queueMicrotask(() => emit(r))
    },
    addEventListener(_type: 'message', l: (e: { data: unknown }) => void) { listeners.add(l) },
  }
  ;(globalThis as { window?: unknown }).window = { WiedisyncNative: native }
  return { sent, emit }
}

let bridge: Bridge
beforeEach(async () => {
  // Fresh module per test: the pending map, listener and hello cache are module state.
  vi.resetModules()
  bridge = await import('./nativeBridge')
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  vi.useRealTimers()
})

describe('nativeBridge', () => {
  it('is absent outside the app', async () => {
    expect(bridge.hasNativeBridge()).toBe(false)
    expect(await bridge.nativeFeatures()).toEqual([])
    await expect(bridge.nativeRequest('share')).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('correlates replies by id and keeps the envelope intact', async () => {
    const { sent } = installFakeBridge((m) => ({ id: m.id, ok: true, result: { echo: m.type } }))
    const [a, b] = await Promise.all([
      bridge.nativeRequest<{ echo: string }>('share', { url: 'https://x', id: 999, type: 'forged' }),
      bridge.nativeRequest<{ echo: string }>('push.state'),
    ])
    expect(a.echo).toBe('share')
    expect(b.echo).toBe('push.state')
    expect(sent[0]).toMatchObject({ type: 'share', url: 'https://x' })
    expect(sent[0].id).not.toBe(sent[1].id)
  })

  it('rejects with the native error code', async () => {
    installFakeBridge((m) => ({ id: m.id, ok: false, error: 'no_distributor', message: 'none installed' }))
    const err = await bridge.nativeRequest('push.subscribe').catch((e: unknown) => e)
    expect(bridge.isNativeBridgeError(err, 'no_distributor')).toBe(true)
    expect(bridge.isNativeBridgeError(err, 'timeout')).toBe(false)
  })

  it('times out when the app never answers', async () => {
    vi.useFakeTimers()
    installFakeBridge()
    const p = bridge.nativeRequest('push.subscribe', {}, 60_000)
    vi.advanceTimersByTime(60_000)
    await expect(p).rejects.toMatchObject({ code: 'timeout' })
  })

  it('ignores malformed and unknown messages', async () => {
    const { emit } = installFakeBridge((m) => ({ id: m.id, ok: true, result: 1 }))
    const p = bridge.nativeRequest('hello')
    emit('not json')
    emit({ id: 12345, ok: true })
    emit(42)
    emit(JSON.stringify(null))
    expect(await p).toBe(1)
  })

  it('sends hello once and caches the features', async () => {
    const { sent } = installFakeBridge((m) => ({ id: m.id, ok: true, result: { platform: 'android', features: ['saveFile', 'push', 7] } }))
    expect(await bridge.nativeFeatures()).toEqual(['saveFile', 'push'])
    expect(await bridge.nativeFeatures()).toEqual(['saveFile', 'push'])
    expect(await bridge.hasNativeFeature('push')).toBe(true)
    expect(await bridge.hasNativeFeature('share')).toBe(false)
    expect(sent.filter((m) => m.type === 'hello')).toHaveLength(1)
  })

  it('retries hello after a failure instead of caching []', async () => {
    let fail = true
    const { sent } = installFakeBridge((m) => (fail ? { id: m.id, ok: false, error: 'boom' } : { id: m.id, ok: true, result: { features: ['share'] } }))
    expect(await bridge.nativeFeatures()).toEqual([])
    fail = false
    expect(await bridge.nativeFeatures()).toEqual(['share'])
    expect(sent).toHaveLength(2)
  })

  it('delivers events to subscribers until they unsubscribe', async () => {
    const { emit } = installFakeBridge()
    const seen: unknown[] = []
    const off = bridge.onNativeEvent<{ subscription: unknown }>('push-endpoint', (e) => seen.push(e.subscription))
    emit({ event: 'push-endpoint', subscription: null })
    emit({ event: 'other', subscription: 'x' })
    off()
    emit({ event: 'push-endpoint', subscription: 'late' })
    expect(seen).toEqual([null])
  })
})
