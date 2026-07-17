import { describe, it, expect } from 'vitest'
import { isTransientNetworkMessage } from './sentry'

// This predicate decides whether a failure is "the request never reached the
// server" (downgrade, keep the session) or a real fault (report, and in
// AuthProvider tear the session down). Both directions have bitten prod, so
// each case below is anchored to a real incident.
describe('isTransientNetworkMessage', () => {
  it('matches the bare browser messages', () => {
    // Chrome / Firefox / Safari each word this differently.
    expect(isTransientNetworkMessage('Failed to fetch')).toBe(true)
    expect(isTransientNetworkMessage('Load failed')).toBe(true)
    expect(isTransientNetworkMessage('NetworkError when attempting to fetch resource')).toBe(true)
    expect(isTransientNetworkMessage('The network connection was lost')).toBe(true)
    expect(isTransientNetworkMessage('The Internet connection appears to be offline')).toBe(true)
  })

  it('tolerates the API host the @directus/sdk appends', () => {
    // Regressed once: without the optional " (…)" suffix the ^…$ anchor missed
    // every SDK reject and mobile aborts paged anyway (prod 2026-06-18).
    expect(isTransientNetworkMessage('Failed to fetch (directus.kscw.ch)')).toBe(true)
    expect(isTransientNetworkMessage('Load failed (directus.kscw.ch)')).toBe(true)
  })

  it('tolerates surrounding whitespace and a trailing period', () => {
    expect(isTransientNetworkMessage('  Failed to fetch  ')).toBe(true)
    expect(isTransientNetworkMessage('Load failed.')).toBe(true)
  })

  it('does NOT swallow a real error that merely contains the words', () => {
    // The ^…$ anchor is load-bearing: a genuine bug whose message quotes these
    // words must still surface as an error, not be downgraded to warn.
    expect(isTransientNetworkMessage('Failed to fetch the roster: invalid team id')).toBe(false)
    expect(isTransientNetworkMessage('Upload failed')).toBe(false)
    expect(isTransientNetworkMessage('TypeError: Load failed while parsing sets_json')).toBe(false)
  })

  it('does NOT match auth faults that must still log the user out', () => {
    // AuthProvider keeps the session when this returns true — so a genuine
    // credential/permission rejection must return false or a dead session
    // would be kept alive forever.
    expect(isTransientNetworkMessage('Invalid user credentials')).toBe(false)
    expect(isTransientNetworkMessage('Token expired.')).toBe(false)
    expect(isTransientNetworkMessage("You don't have permission to access this.")).toBe(false)
    expect(isTransientNetworkMessage('')).toBe(false)
  })
})
