// The token IS the path for every anonymous flow in this app, so this regex is
// the only thing between a live capability credential and both a 30-day log
// file and a third-party processor (audit 2026-08-08, finding 14).
import { describe, it, expect } from 'vitest'
import { looksLikeToken, redactTokens } from './sentry'

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

  // Public event share links are base64url, not hex: `randomBytes(32).toString('base64url')`
  // in public-event-signup.js. The hex rule never matched them (security audit 2026-10).
  const shareToken = 'Zk3_q9-LmN0pQrStUvWxYz012345AbCdEfGhIjKlMnO' // gitleaks:allow — synthetic fixture, 43 chars

  it('redacts the base64url event share token on the app page and its API', () => {
    expect(redactTokens(`https://wiedisync.kscw.ch/e/${shareToken}`)).toBe('https://wiedisync.kscw.ch/e/:token')
    expect(redactTokens(`API /public/events/${shareToken}/signup: 409`)).toBe('API /public/events/:token/signup: 409')
    // Even a share token with no digit and one case only — the explicit rule does not guess.
    expect(redactTokens('/e/abcdefghij')).toBe('/e/:token')
  })

  it('does not leave the tail of a base64url token that opens with hex', () => {
    expect(redactTokens('/e/0123456789abcdefXYZ_-qrstuvwxyzABCDEFGHIJ')).toBe('/e/:token')
    expect(redactTokens('/x/0123456789abcdefXYZ_-qrstuvwxyzABCDEFGHIJ/y')).toBe('/x/:token/y')
  })

  it('redacts any whole random-looking segment of 24+ url-safe chars', () => {
    expect(redactTokens(`/kscw/some-future-route/${shareToken}`)).toBe('/kscw/some-future-route/:token')
    expect(redactTokens(`API /kscw/x/${shareToken}: 400`)).toBe('API /kscw/x/:token: 400')
    expect(redactTokens(`/kscw/x/${shareToken}?a=1`)).toBe('/kscw/x/:token?a=1')
  })

  it('keeps route slugs and hashed asset names in stack frames readable', () => {
    for (const p of [
      '/kscw/clubdesk-registration-status',
      '/kscw/admin/terminplanung/invites/import-from-svrz',
      'https://wiedisync.kscw.ch/assets/SpielplanungAdminPage-Dk3j4kLm.js:12:345',
      '/events/42/share-token',
      '/e/:token',
    ]) {
      expect(redactTokens(p)).toBe(p)
    }
  })

  it('looksLikeToken: random strings yes, lowercase slugs no', () => {
    expect(looksLikeToken(shareToken)).toBe(true)
    expect(looksLikeToken('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(looksLikeToken('abcdefghijklmnopqrstuvwXYZ')).toBe(true)
    expect(looksLikeToken('clubdesk-registration-status')).toBe(false)
    expect(looksLikeToken('deadbeefdeadbeefdeadbeef')).toBe(false) // the hex rule's job
  })

  it('passes non-strings through untouched', () => {
    expect(redactTokens(null)).toBeNull()
    expect(redactTokens(42)).toBe(42)
  })
})
