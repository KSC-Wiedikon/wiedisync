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

  it('redacts credential values in query strings (reset JWT, OAuth code, invite)', () => {
    expect(redactTokens('https://wiedisync.kscw.ch/set-password?token=eyJhbGciOi.eyJpZCI6.sig-_x')) // gitleaks:allow — synthetic fixture
      .toBe('https://wiedisync.kscw.ch/set-password?token=[redacted]') // gitleaks:allow — synthetic fixture
    expect(redactTokens('/cb?state=abc&code=4/0AbC-xyz&scope=email#frag')) // gitleaks:allow — synthetic fixture
      .toBe('/cb?state=abc&code=[redacted]&scope=email#frag') // gitleaks:allow — synthetic fixture
    expect(redactTokens('/join?invite=Zz9&t=123&access_token=a.b.c&refresh_token=r&KEY=k')) // gitleaks:allow — synthetic fixture
      .toBe('/join?invite=[redacted]&t=[redacted]&access_token=[redacted]&refresh_token=[redacted]&KEY=[redacted]')
  })

  it('leaves non-credential query params alone', () => {
    for (const p of ['/calendar?view=month&team=3', '/games?tab=upcoming&sort=date', '/x?tokens=1&kind=2']) {
      expect(redactTokens(p)).toBe(p)
    }
  })

  it('passes non-strings through untouched', () => {
    expect(redactTokens(null)).toBeNull()
    expect(redactTokens(42)).toBe(42)
  })
})
