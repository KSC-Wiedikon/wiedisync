// The token IS the path for every anonymous flow in this app, so this regex is
// the only thing between a live capability credential and both a 30-day log
// file and a third-party processor (audit 2026-08-08, finding 14).
import { describe, it, expect } from 'vitest'
import { redactTokens } from './sentry'

describe('redactTokens', () => {
  it('redacts a portal token in a path', () => {
    expect(redactTokens('/kscw/terminplanung/propose-home/a1b2c3d4e5f60718a9b0c1d2e3f40516'))
      .toBe('/kscw/terminplanung/propose-home/:token')
  })

  it('redacts a token followed by a COLON — api.ts builds `API ${path}: ${status}`', () => {
    // The first boundary I wrote was [/?#]|$ and missed exactly this, leaving
    // the token in the Sentry exception value even with `endpoint` clean.
    expect(redactTokens('API /team-invites/info/deadbeefdeadbeefdeadbeef: 400'))
      .toBe('API /team-invites/info/:token: 400')
  })

  it('redacts before a query string', () => {
    expect(redactTokens('/terminplanung/9f8e7d6c5b4a39281706f5e4d3c2b1a0?x=1'))
      .toBe('/terminplanung/:token?x=1')
  })

  it('leaves ordinary paths, numeric ids and asset names alone', () => {
    for (const p of ['/kscw/public/team/80', '/kscw/admin/error-logs', '/assets/App-BONV5kks.js']) {
      expect(redactTokens(p)).toBe(p)
    }
  })

  it('floors at 16 hex chars — the shortest token the backend mints', () => {
    expect(redactTokens('/kscw/games/1234567890abcdef')).toBe('/kscw/games/:token')
    expect(redactTokens('/kscw/games/1234567890abcde')).toBe('/kscw/games/1234567890abcde')
  })

  it('passes non-strings through untouched', () => {
    expect(redactTokens(null)).toBeNull()
    expect(redactTokens(42)).toBe(42)
  })
})
