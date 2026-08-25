import { describe, it, expect } from 'vitest'
import { classifySyncFailure, SYNC_FAILURE_KEY } from '../syncFailure'

describe('classifySyncFailure', () => {
  it('reads the real outage that prompted this — ClubDesk unreachable', () => {
    // Verbatim from member-dispatch-prod.log, 25.08.2026 10:06 and 10:15 UTC.
    expect(classifySyncFailure('page.goto: net::ERR_TIMED_OUT at https://app.clubdesk.com/clubdesk/start'))
      .toBe('clubdesk_unreachable')
  })

  it('covers the other ways the far end goes dark', () => {
    for (const m of [
      'page.goto: net::ERR_CONNECTION_REFUSED at https://app.clubdesk.com/',
      'net::ERR_NAME_NOT_RESOLVED',
      'net::ERR_SSL_PROTOCOL_ERROR',
      'connect ETIMEDOUT 5.148.169.160:443',
      'Timeout 30000ms exceeded.',
    ]) expect(classifySyncFailure(m), m).toBe('clubdesk_unreachable')
  })

  it('separates our broken tooling from their broken server', () => {
    // Both of these HAVE happened: the launch failure on 18.08.2026, and the
    // execute-bit loss documented in INFRA.md → Troubleshooting.
    expect(classifySyncFailure('browserType.launch: Target page, context or browser has been closed'))
      .toBe('scraper_broken')
    expect(classifySyncFailure('flock: failed to execute /opt/clubdesk-sync/clubdesk-sync.sh: Permission denied'))
      .toBe('scraper_broken')
  })

  it('ranks scraper over unreachable when a message could read as both', () => {
    // A launch failure that also mentions a timeout must not be reported as
    // "ClubDesk is down" — that would send the operator to wait for a vendor
    // who is fine.
    expect(classifySyncFailure('browserType.launch: Timeout 30000ms exceeded.')).toBe('scraper_broken')
  })

  it('recognises a refused login', () => {
    expect(classifySyncFailure('Login failed — check the ClubDesk credentials')).toBe('login_failed')
  })

  it('recognises the dispatcher\'s own stale-run reset, which is not a failure of ClubDesk', () => {
    expect(classifySyncFailure('Reset (stale run — will retry)')).toBe('stale_reset')
  })

  it('falls back rather than guessing', () => {
    expect(classifySyncFailure('something nobody has seen before')).toBe('unknown')
    expect(classifySyncFailure('')).toBe('unknown')
    expect(classifySyncFailure(null)).toBe('unknown')
    expect(classifySyncFailure(undefined)).toBe('unknown')
  })

  it('matches case-insensitively — Playwright wording is not stable in case', () => {
    expect(classifySyncFailure('PAGE.GOTO: NET::ERR_TIMED_OUT')).toBe('clubdesk_unreachable')
  })

  it('has a label key for every kind', () => {
    for (const k of ['clubdesk_unreachable', 'login_failed', 'scraper_broken', 'stale_reset', 'unknown'] as const) {
      expect(SYNC_FAILURE_KEY[k], k).toBeTruthy()
    }
  })
})
