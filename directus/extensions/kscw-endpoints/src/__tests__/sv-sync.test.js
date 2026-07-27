/**
 * Unit tests for the sv-sync update-path guards (sv-sync.js) — the pure logic
 * deciding whether a feed row rewrites an existing `games` row.
 *
 *  • applyLocalGuards — app-owned fields the feed must never clobber: a local
 *    cancel stays cancelled until the game is actually completed (the feed
 *    keeps serving 'scheduled' and used to silently resurrect the game), and
 *    kscw_team is never downgraded to NULL when the active-only team lookup
 *    misses (an archived-without-successor team lost its whole season history
 *    that way — DU23-2's 2025/26, NULLed by the 2026-06-30 cron run).
 *  • cmpVal — change-detection normalization: pg returns date columns as JS
 *    Date objects, time as HH:MM:SS and json columns parsed, while the feed
 *    side holds strings — naive String() coercion flagged every game as
 *    changed on every run.
 *
 * Hermetic — pure functions, no DB or network. sv-sync.js requires SV_API_KEY
 * at import time, so it is pinned before the dynamic import.
 */
import { describe, it, expect } from 'vitest'

process.env.SV_API_KEY ||= 'test-key'
const { applyLocalGuards, cmpVal } = await import('../sv-sync.js')

describe('applyLocalGuards — local cancel preservation', () => {
  it('keeps a locally-cancelled game cancelled when the feed still says scheduled', () => {
    const data = { status: 'scheduled', kscw_team: 5 }
    applyLocalGuards(data, { status: 'cancelled', kscw_team: 5 })
    expect(data.status).toBe('cancelled')
  })

  it('lets an actual result through — completed overrides the local cancel', () => {
    const data = { status: 'completed', kscw_team: 5 }
    applyLocalGuards(data, { status: 'cancelled', kscw_team: 5 })
    expect(data.status).toBe('completed')
  })

  it('keeps a locally-postponed game postponed when the feed still says scheduled', () => {
    const data = { status: 'scheduled', kscw_team: 5 }
    applyLocalGuards(data, { status: 'postponed', kscw_team: 5 })
    expect(data.status).toBe('postponed')
  })

  it('completed overrides a local postponed too', () => {
    const data = { status: 'completed', kscw_team: 5 }
    applyLocalGuards(data, { status: 'postponed', kscw_team: 5 })
    expect(data.status).toBe('completed')
  })

  it('leaves non-cancelled rows alone (scheduled → completed syncs normally)', () => {
    const data = { status: 'completed', kscw_team: 5 }
    applyLocalGuards(data, { status: 'scheduled', kscw_team: 5 })
    expect(data.status).toBe('completed')
  })

  it('a preserved cancel does not register as a diff — the row is not rewritten nightly', () => {
    // pg-shaped existing row vs feed-shaped data for an otherwise unchanged game.
    const existing = {
      status: 'cancelled', kscw_team: 5,
      date: new Date(2026, 2, 28), time: '15:00:00',
      sets_json: [], referees_json: [],
    }
    const data = {
      status: 'scheduled', kscw_team: 5,
      date: '2026-03-28', time: '15:00',
      sets_json: '[]', referees_json: '[]',
    }
    applyLocalGuards(data, existing)
    const fields = ['date', 'time', 'status', 'kscw_team', 'sets_json', 'referees_json']
    const changed = fields.some(f => cmpVal(f, data[f]) !== cmpVal(f, existing[f]))
    expect(changed).toBe(false)
  })
})

describe('applyLocalGuards — kscw_team never downgrades to NULL', () => {
  it('keeps the existing team pointer when the active-only lookup resolved nothing', () => {
    const data = { status: 'scheduled', kscw_team: null }
    applyLocalGuards(data, { status: 'completed', kscw_team: 10 })
    expect(data.kscw_team).toBe(10)
  })

  it('still re-points to the resolved team on a season rollover', () => {
    const data = { status: 'scheduled', kscw_team: 67 }
    applyLocalGuards(data, { status: 'scheduled', kscw_team: 10 })
    expect(data.kscw_team).toBe(67)
  })

  it('leaves both-NULL untouched', () => {
    const data = { status: 'scheduled', kscw_team: null }
    applyLocalGuards(data, { status: 'scheduled', kscw_team: null })
    expect(data.kscw_team).toBe(null)
  })
})

describe('cmpVal — change-detection normalization', () => {
  it('normalizes a pg Date against the feed date string', () => {
    // pg (node-postgres) hands DATE columns back as a Date at LOCAL midnight —
    // mirror that shape (never new Date('YYYY-MM-DD'), which parses as UTC).
    expect(cmpVal('date', new Date(2026, 2, 28))).toBe('2026-03-28')
    expect(cmpVal('date', '2026-03-28')).toBe('2026-03-28')
  })

  it('normalizes pg HH:MM:SS against the feed HH:MM', () => {
    expect(cmpVal('time', '19:30:00')).toBe('19:30')
    expect(cmpVal('time', '19:30')).toBe('19:30')
  })

  it('normalizes parsed json columns against the strings we write', () => {
    expect(cmpVal('sets_json', [])).toBe('[]')
    expect(cmpVal('sets_json', '[]')).toBe('[]')
    expect(cmpVal('referees_json', [{ name: 'A B', id: 1 }]))
      .toBe(JSON.stringify([{ name: 'A B', id: 1 }]))
    expect(cmpVal('away_hall_json', { name: 'X' })).toBe('{"name":"X"}')
  })

  it('maps nullish to the empty string and coerces scalars', () => {
    expect(cmpVal('hall', null)).toBe('')
    expect(cmpVal('away_hall_json', undefined)).toBe('')
    expect(cmpVal('home_score', 3)).toBe('3')
    expect(cmpVal('home_score', '3')).toBe('3')
  })
})
