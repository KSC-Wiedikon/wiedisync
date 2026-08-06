// Sport resolution for the Data Explorer's member view.
//
// Every case below is a bug that shipped, or would have:
//   • a coach has no member_teams row, so a player-only join reports "no team"
//     and hides the entire Basketplan block from the person who needs it;
//   • team NAMES lie — "Herren 2 H3" and "Damen D-Classics 1LR" are basketball,
//     so anything that reads a name instead of teams.sport is wrong by design;
//   • sektion=KSCW, Passivmitglied, Gratis and Kein Beitrag carry no sport at
//     all, and answering "neither" would hide a real, editable column behind a
//     gate the admin cannot open.

import { describe, it, expect } from 'vitest'
import { resolveMemberSport, sportCovers, type MemberSportCache } from '../memberSport'

/** Team ids mirror the real shape: strings on the cache, mixed types tolerated. */
const TEAMS = [
  { id: '1', sport: 'volleyball' },
  { id: '2', sport: 'volleyball' },
  // ⚠ Basketball teams with volleyball-sounding names. This is prod data.
  { id: '10', sport: 'basketball' },   // "Herren 2 H3"
  { id: '11', sport: 'basketball' },   // "Damen D-Classics 1LR"
  { id: '20', sport: 'other' },        // a non-sport team (e.g. a committee)
]

function cache(opts: {
  players?: Record<string, string[]>
  coaches?: Record<string, string[]>
  responsibles?: Record<string, string[]>
} = {}): MemberSportCache {
  return {
    teams: TEAMS,
    memberTeams: new Map(Object.entries(opts.players ?? {})),
    memberCoachTeams: new Map(Object.entries(opts.coaches ?? {})),
    memberTrTeams: new Map(Object.entries(opts.responsibles ?? {})),
  }
}

describe('resolveMemberSport — step 1, the three team relations', () => {
  it('resolves a volleyball player from their roster row', () => {
    expect(resolveMemberSport({ id: 5 }, cache({ players: { '5': ['1'] } }))).toBe('volleyball')
  })

  it('resolves a basketball coach who has NO roster row', () => {
    // The whole reason all three junctions are consulted: coaches are never in
    // member_teams, so a player-only lookup returns "no team" for every coach.
    const c = cache({ coaches: { '7': ['10'] } })
    expect(resolveMemberSport({ id: 7 }, c)).toBe('basketball')
  })

  it('resolves a team responsible the same way', () => {
    expect(resolveMemberSport({ id: 8 }, cache({ responsibles: { '8': ['11'] } }))).toBe('basketball')
  })

  it('never reads the sport off a team NAME — "Herren 2 H3" is basketball', () => {
    // Team 10 is named like a volleyball men's team and is not one. Only
    // teams.sport is consulted, so the answer is basketball.
    expect(resolveMemberSport({ id: 9 }, cache({ players: { '9': ['10'] } }))).toBe('basketball')
  })

  it('returns "both" for a dual-sport member', () => {
    const c = cache({ players: { '3': ['1'] }, coaches: { '3': ['10'] } })
    expect(resolveMemberSport({ id: 3 }, c)).toBe('both')
  })

  it('ignores teams whose sport is neither, and falls through', () => {
    // Team 20 has sport 'other' → contributes nothing, so sektion decides.
    const c = cache({ players: { '4': ['20'] } })
    expect(resolveMemberSport({ id: 4, sektion: 'Basketball' }, c)).toBe('basketball')
  })

  it('ignores team ids that are not in the cache (out-of-scope / inactive teams)', () => {
    const c = cache({ players: { '4': ['999'] } })
    expect(resolveMemberSport({ id: 4, sektion: 'Volleyball' }, c)).toBe('volleyball')
  })

  it('accepts numeric member ids and numeric team ids', () => {
    const c: MemberSportCache = {
      teams: [{ id: 1, sport: 'volleyball' }],
      memberTeams: new Map([['42', ['1']]]),
      memberCoachTeams: new Map(),
      memberTrTeams: new Map(),
    }
    expect(resolveMemberSport({ id: 42 }, c)).toBe('volleyball')
  })

  it('lets teams win over a contradicting sektion', () => {
    const c = cache({ players: { '6': ['10'] } })
    expect(resolveMemberSport({ id: 6, sektion: 'Volleyball' }, c)).toBe('basketball')
  })
})

describe('resolveMemberSport — step 2, sektion', () => {
  it('reads Volleyball / Basketball case- and whitespace-insensitively', () => {
    expect(resolveMemberSport({ id: 1, sektion: ' volleyball ' }, cache())).toBe('volleyball')
    expect(resolveMemberSport({ id: 1, sektion: 'BASKETBALL' }, cache())).toBe('basketball')
  })

  it('treats sektion=KSCW as club-level and shows BOTH sports', () => {
    expect(resolveMemberSport({ id: 1, sektion: 'KSCW' }, cache())).toBe('both')
  })

  it('falls through on an unrecognised sektion', () => {
    expect(resolveMemberSport({ id: 1, sektion: 'Turnen', beitragskategorie: 'VB Erwerbstätige' }, cache()))
      .toBe('volleyball')
  })
})

describe('resolveMemberSport — step 3, the fee-category prefix', () => {
  it('reads a BB-prefixed category', () => {
    expect(resolveMemberSport({ id: 1, beitragskategorie: 'BB Jugend Meisterschaft' }, cache()))
      .toBe('basketball')
  })

  it('reads a VB-prefixed category', () => {
    expect(resolveMemberSport({ id: 1, beitragskategorie: 'VB Schüler*in Meisterschaft' }, cache()))
      .toBe('volleyball')
  })

  it('treats the sport-less categories as club-level', () => {
    for (const cat of ['Passivmitglied', 'Gratis', 'Kein Beitrag']) {
      expect(resolveMemberSport({ id: 1, beitragskategorie: cat }, cache()), cat).toBe('both')
    }
  })

  it('does not match a bare "VB" with no trailing space', () => {
    // 'VBC Zürich' must not be read as a volleyball fee category.
    expect(resolveMemberSport({ id: 1, beitragskategorie: 'VBC something' }, cache())).toBe('both')
  })
})

describe('resolveMemberSport — the default', () => {
  it('returns "both" for a member with nothing at all', () => {
    expect(resolveMemberSport({ id: 1 }, cache())).toBe('both')
  })

  it('returns "both" when the cache has not landed yet', () => {
    expect(resolveMemberSport({ id: 1 }, null)).toBe('both')
    expect(resolveMemberSport({ id: 1 }, undefined)).toBe('both')
  })

  it('still reads sektion / category with no cache', () => {
    expect(resolveMemberSport({ id: 1, sektion: 'Basketball' }, null)).toBe('basketball')
    expect(resolveMemberSport({ id: 1, beitragskategorie: 'BB Minis Turnier' }, undefined)).toBe('basketball')
  })

  it('ignores non-string sektion / category values', () => {
    expect(resolveMemberSport({ id: 1, sektion: 42, beitragskategorie: null }, cache())).toBe('both')
  })
})

describe('sportCovers', () => {
  it('lets "both" cover every gate', () => {
    expect(sportCovers('both', 'volleyball')).toBe(true)
    expect(sportCovers('both', 'basketball')).toBe(true)
  })

  it('covers only the member\'s own gate otherwise', () => {
    expect(sportCovers('volleyball', 'volleyball')).toBe(true)
    expect(sportCovers('volleyball', 'basketball')).toBe(false)
    expect(sportCovers('basketball', 'volleyball')).toBe(false)
  })
})
