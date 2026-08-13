import { describe, it, expect } from 'vitest'
import { isSessionExpired } from '../sessionError'

/**
 * The 401-vs-403 distinction, pinned.
 *
 * This predicate decides whether a member gets told their session died. Widening it to
 * 403 would sign people out of a live tool on a Cloudflare WAF block, on a collection
 * they simply may not read, and during the token-refresh race — and the resulting
 * reload re-fires a ~350-request boot, turning a transient block into a sustained one.
 * That is the failure AuthProvider's session-restore path was already written to avoid;
 * this test is what stops it being reintroduced one layer up.
 */
describe('isSessionExpired', () => {
  it('accepts an explicit 401, in both shapes the SDK produces', () => {
    expect(isSessionExpired({ status: 401 })).toBe(true)
    expect(isSessionExpired({ response: { status: 401 } })).toBe(true)
  })

  it('accepts the Directus codes that mean the same thing', () => {
    expect(isSessionExpired({ errors: [{ extensions: { code: 'TOKEN_EXPIRED' } }] })).toBe(true)
    expect(isSessionExpired({ errors: [{ extensions: { code: 'INVALID_CREDENTIALS' } }] })).toBe(true)
  })

  it('REFUSES 403 — the whole point', () => {
    // Cloudflare WAF block.
    expect(isSessionExpired({ status: 403 })).toBe(false)
    expect(isSessionExpired({ response: { status: 403 } })).toBe(false)
    // "You may not read this collection" — says nothing about the session.
    expect(isSessionExpired({
      status: 403,
      message: "You don't have permission to access collection members",
    })).toBe(false)
    // The Directus permission code raised during the token-refresh race.
    expect(isSessionExpired({ errors: [{ extensions: { code: 'FORBIDDEN' } }] })).toBe(false)
  })

  it('refuses every other failure a query can produce', () => {
    expect(isSessionExpired({ status: 500 })).toBe(false)
    expect(isSessionExpired({ status: 404 })).toBe(false)
    expect(isSessionExpired({ status: 429 })).toBe(false)
    // A statusless reject — the dropped-signal / backgrounded-tab case that
    // AuthProvider explicitly refuses to treat as a dead session.
    expect(isSessionExpired(new Error('Failed to fetch'))).toBe(false)
    expect(isSessionExpired(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(false)
  })

  it('survives malformed and empty inputs rather than throwing', () => {
    // This runs inside a global error handler; throwing here would mask the real error.
    for (const bad of [null, undefined, {}, 'nope', 42, [], { errors: null }, { errors: [null] }]) {
      expect(() => isSessionExpired(bad)).not.toThrow()
      expect(isSessionExpired(bad)).toBe(false)
    }
  })
})
