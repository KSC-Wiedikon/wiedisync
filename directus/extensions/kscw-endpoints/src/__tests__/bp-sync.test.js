/**
 * Unit tests for the bp-sync update-path guards (bp-sync.js).
 *
 *  • cmpVal — the normalizer ported from sv-sync (which fixed the same trap
 *    on 2026-07-04): pg returns date columns as JS Date objects, time as
 *    HH:MM:SS and json parsed, so the old naive String() coercion flagged
 *    every BB game as changed on every run — all 208 rows rewritten nightly,
 *    defeating the skip that exists to avoid trigger notification spam.
 *  • applyLocalGuards — a local cancel survives the feed (Basketplan has no
 *    notion of it; only a played result overrides), and hall/away_hall_json
 *    default to the existing value when the feed resolves nothing, so an
 *    absent key neither clears a hand-set hall nor reads as a change.
 *
 * The headline regression here is the "unchanged nightly run" case: a row
 * exactly as pg returns it vs the same game exactly as the feed builds it
 * must compare as NOT changed.
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { applyLocalGuards, cmpVal, buildGameIntents } from '../bp-sync.js'

// bp-sync's COMPARE_FIELDS (module-internal; mirrored here as the contract).
const COMPARE_FIELDS = [
  'date', 'time', 'status', 'home_score', 'away_score',
  'home_team', 'away_team', 'hall', 'away_hall_json', 'league',
  'kscw_team',
]

// A home game exactly as pg hands the existing row back: DATE at local
// midnight, TIME with seconds, json parsed, no away venue.
const pgHomeRow = () => ({
  status: 'scheduled', kscw_team: 40,
  date: new Date(2026, 9, 24), time: '14:30:00',
  home_score: 0, away_score: 0,
  home_team: 'KSC Wiedikon Basketball H2', away_team: 'BC Divac',
  hall: 3, away_hall_json: null, league: '2LM',
})

// The same game exactly as syncBpGames builds `data` when HALL_MAP misses
// (hall key absent — e.g. a hand-set Döltschi hall) and there is no away venue.
const feedHomeData = () => ({
  status: 'scheduled', kscw_team: 40,
  date: '2026-10-24', time: '14:30',
  home_score: 0, away_score: 0,
  home_team: 'KSC Wiedikon Basketball H2', away_team: 'BC Divac',
  league: '2LM',
})

const isChanged = (data, existing) =>
  COMPARE_FIELDS.some(f => cmpVal(f, data[f]) !== cmpVal(f, existing[f]))

describe('unchanged nightly run — the GAMES-08 regression', () => {
  it('an unchanged home game compares as NOT changed (no nightly rewrite)', () => {
    const existing = pgHomeRow()
    const data = feedHomeData()
    applyLocalGuards(data, existing)
    expect(isChanged(data, existing)).toBe(false)
  })

  it('an unchanged away game (json venue) compares as NOT changed', () => {
    const venue = { name: 'Saalsporthalle', address: 'Giesshübelstrasse 45', city: 'Zürich' }
    const existing = { ...pgHomeRow(), hall: null, away_hall_json: venue }
    const data = { ...feedHomeData(), away_hall_json: JSON.stringify(venue) }
    applyLocalGuards(data, existing)
    expect(isChanged(data, existing)).toBe(false)
  })

  it('a real change still registers — a moved date', () => {
    const existing = pgHomeRow()
    const data = { ...feedHomeData(), date: '2026-10-25' }
    applyLocalGuards(data, existing)
    expect(isChanged(data, existing)).toBe(true)
  })

  it('a real change still registers — a result coming in', () => {
    const existing = pgHomeRow()
    const data = { ...feedHomeData(), status: 'completed', home_score: 68, away_score: 54 }
    applyLocalGuards(data, existing)
    expect(isChanged(data, existing)).toBe(true)
  })
})

describe('applyLocalGuards — local cancel preservation', () => {
  it('keeps a locally-cancelled game cancelled when the feed says scheduled', () => {
    const data = { ...feedHomeData() }
    applyLocalGuards(data, { ...pgHomeRow(), status: 'cancelled' })
    expect(data.status).toBe('cancelled')
  })

  it('keeps the local cancel on a Basketplan withdrawal too (maps to postponed)', () => {
    const data = { ...feedHomeData(), status: 'postponed' }
    applyLocalGuards(data, { ...pgHomeRow(), status: 'cancelled' })
    expect(data.status).toBe('cancelled')
  })

  it('lets a played result through — completed overrides the local cancel', () => {
    const data = { ...feedHomeData(), status: 'completed', home_score: 68, away_score: 54 }
    applyLocalGuards(data, { ...pgHomeRow(), status: 'cancelled' })
    expect(data.status).toBe('completed')
  })

  it('a preserved cancel does not register as a diff — the row is not rewritten nightly', () => {
    const existing = { ...pgHomeRow(), status: 'cancelled' }
    const data = feedHomeData()
    applyLocalGuards(data, existing)
    expect(isChanged(data, existing)).toBe(false)
  })
})

describe('applyLocalGuards — hall / away venue defaulting', () => {
  it('keeps the existing hall when the feed resolves nothing (absent key)', () => {
    const data = feedHomeData()
    applyLocalGuards(data, pgHomeRow())
    expect(data.hall).toBe(3)
  })

  it('the feed still wins when it resolves a hall', () => {
    const data = { ...feedHomeData(), hall: 7 }
    const existing = pgHomeRow()
    applyLocalGuards(data, existing)
    expect(data.hall).toBe(7)
    expect(isChanged(data, existing)).toBe(true)
  })

  it('keeps the existing away venue when the feed sends none', () => {
    const venue = { name: 'Saalsporthalle', city: 'Zürich' }
    const data = feedHomeData()
    applyLocalGuards(data, { ...pgHomeRow(), away_hall_json: venue })
    expect(data.away_hall_json).toEqual(venue)
  })
})

describe('cmpVal — normalization primitives', () => {
  it('pg Date (local midnight) equals the feed date string', () => {
    expect(cmpVal('date', new Date(2026, 9, 24))).toBe('2026-10-24')
    expect(cmpVal('date', '2026-10-24')).toBe('2026-10-24')
  })

  it('pg HH:MM:SS equals the feed HH:MM', () => {
    expect(cmpVal('time', '14:30:00')).toBe('14:30')
    expect(cmpVal('time', '14:30')).toBe('14:30')
  })

  it('parsed json equals the string we write; nullish maps to empty string', () => {
    expect(cmpVal('away_hall_json', { name: 'X' })).toBe('{"name":"X"}')
    expect(cmpVal('away_hall_json', '{"name":"X"}')).toBe('{"name":"X"}')
    expect(cmpVal('away_hall_json', null)).toBe('')
    expect(cmpVal('hall', null)).toBe('')
    expect(cmpVal('home_score', 68)).toBe('68')
  })
})

// ── buildGameIntents — the two-row derby model (audit 2026-08-08, #34) ───────
// bp-sync wrote ONE games row per fixture, keyed on game_id alone. For an
// intra-club fixture that means the away squad gets no row at all: no
// participations from sweepGameAutoConfirm (it joins member_teams on
// g.kscw_team) and no respond_by reminder — silently. Latent today because all
// 17 active BB teams sit in distinct Basketplan groups, but migration 287 seeds
// DU18 A and DU18 B into the same group and it goes live the moment DU18 B gets
// a teams row.
describe('buildGameIntents', () => {
  const HOME_AWAY = { homeTeamId: '111', guestTeamId: '222' }

  it('emits ONE intent for an ordinary home game', () => {
    const out = buildGameIntents({ ...HOME_AWAY, isHome: true, isGuestOurs: false }, 7, null)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ bpId: '111', type: 'home', hall: 7 })
  })

  it('emits ONE intent for an ordinary away game, keeping away_hall_json', () => {
    const away = { name: 'Sporthalle X', address: 'Y 1', city: 'Zürich' }
    const out = buildGameIntents({ ...HOME_AWAY, isHome: false, isGuestOurs: false }, null, away)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ bpId: '222', type: 'away', awayHallJson: away })
  })

  it('emits TWO intents when BOTH sides are ours — one per KSCW team', () => {
    const out = buildGameIntents({ ...HOME_AWAY, isHome: true, isGuestOurs: true }, 7, null)
    expect(out).toHaveLength(2)
    expect(out.map((i) => i.bpId)).toEqual(['111', '222'])
    expect(out.map((i) => i.type)).toEqual(['home', 'away'])
  })

  it('puts BOTH derby rows at our hall and neither at an away venue', () => {
    // The fixture is at our venue, so it is nobody's away game — an
    // away_hall_json here would send the second team to a hall they are at.
    const out = buildGameIntents({ ...HOME_AWAY, isHome: true, isGuestOurs: true }, 7, { name: 'wrong' })
    expect(out.every((i) => i.hall === 7)).toBe(true)
    expect(out.every((i) => i.awayHallJson === null)).toBe(true)
  })

  it('does NOT treat an away fixture as intra-club even if the guest flag is set', () => {
    // isGuestOurs only means "the guest side is a KSCW team". Without isHome we
    // are the guest, so there is exactly one KSCW side.
    const out = buildGameIntents({ ...HOME_AWAY, isHome: false, isGuestOurs: true }, null, null)
    expect(out).toHaveLength(1)
    expect(out[0].bpId).toBe('222')
  })

  it('treats a missing isGuestOurs as not-intra-club (feeds predating the flag)', () => {
    const out = buildGameIntents({ ...HOME_AWAY, isHome: true }, 7, null)
    expect(out).toHaveLength(1)
  })
})
