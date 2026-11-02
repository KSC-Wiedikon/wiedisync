import { describe, it, expect } from 'vitest'
import { subscriptionUsesKey } from './usePushNotifications'

// 2026-11-02: a subscription made with another VAPID key showed "on" while the
// push service refused every push to it. The push sync re-subscribes when the
// key the browser holds is not the server's.
// A synthetic uncompressed P-256 point (0x04 + 64 bytes), base64url like the real key.
const KEY = btoa(String.fromCharCode(4, ...Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function bytesOf(b64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer
}

describe('subscriptionUsesKey', () => {
  it('matches the key the subscription was made with', () => {
    expect(subscriptionUsesKey(bytesOf(KEY), KEY)).toBe(true)
  })

  it('spots a subscription made with another key', () => {
    const other = new Uint8Array(bytesOf(KEY))
    other[10] ^= 0xff
    expect(subscriptionUsesKey(other.buffer, KEY)).toBe(false)
    expect(subscriptionUsesKey(new Uint8Array(32).buffer, KEY)).toBe(false)
  })

  it('treats a browser that does not report the key as a match', () => {
    expect(subscriptionUsesKey(null, KEY)).toBe(true)
    expect(subscriptionUsesKey(undefined, KEY)).toBe(true)
  })
})
