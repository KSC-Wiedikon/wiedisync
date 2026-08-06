import { describe, it, expect } from 'vitest'
import { homeGamesFor, groupStatusOf } from '../bbHomeGames'
import { BB_GROUPS, KSCW_TEAM_GROUP } from '../../data/basketballGroups'
import groupFormat from '../../data/bbGroupFormat.json'

/** bb_source_ids from prod (migration 278 / basketballGroups.ts). */
const LIONS_D1 = '4445'
const HERREN_1 = '1348'
const DU18_A = '5697'
const DU18_B = '7182'

describe('homeGamesFor — the two teams with a filing deadline', () => {
  it('Lions D1 gets 9 from the workbook, NOT 7 from the group size', () => {
    // The regression this file exists for. D1LRA lists EIGHT teams, so the old
    // (size - 1) arithmetic said 7 — but the workbook states 18 Spiele, i.e. 9 home.
    // Lions D1 files with ProBasket by 17.08.2026, so this is the expensive one to get wrong.
    const r = homeGamesFor(LIONS_D1)
    expect(r.groupCode).toBe('D1LRA')
    expect(r.groupSize).toBe(8)
    expect(r.gamesTotal).toBe(18)
    expect(r.count).toBe(9)
    expect(r.count).not.toBe((r.groupSize ?? 0) - 1)
    expect(r.reason).toBeNull()
    expect(r.approximate).toBe(false)
  })

  it('Herren 1 needs 9 (18 Spiele)', () => {
    const r = homeGamesFor(HERREN_1)
    expect(r.groupCode).toBe('H1LRA')
    expect(r.gamesTotal).toBe(18)
    expect(r.count).toBe(9)
  })
})

describe('a stated game count does not require a settled group', () => {
  it('DU14 gets 3 even though its group still lists the whole league', () => {
    // DU14 Regional holds 11 teams (split at the Spielplansitzung) yet states 6 Spiele.
    // Group composition and game count are independent — the old model conflated them and
    // blanked this team.
    const du14 = Object.keys(KSCW_TEAM_GROUP).find((id) => KSCW_TEAM_GROUP[id] === 'DU14 Regional')
    const r = homeGamesFor(du14)
    expect(r.groupSize).toBe(11)
    expect(r.gamesTotal).toBe(6)
    expect(r.count).toBe(3)
  })
})

describe('homeGamesFor — refuses to invent a number', () => {
  it('blanks H4LRA, where the workbook states no game count at all', () => {
    // Herren 3 (Unicorns): 30 teams listed and an EMPTY Anzahl Spiele. The naive size-1 would
    // have claimed 29 home games.
    const unicorns = Object.keys(KSCW_TEAM_GROUP).find((id) => KSCW_TEAM_GROUP[id] === 'H4LRA')
    expect(unicorns).toBeDefined()
    const r = homeGamesFor(unicorns)
    expect(BB_GROUPS.H4LRA.teams.length).toBeGreaterThan(20)
    expect(r.count).toBeNull()
    expect(r.gamesTotal).toBeNull()
    expect(r.reason).toBe('provisional')
    expect(r.groupSize).toBe(BB_GROUPS.H4LRA.teams.length)
  })

  it('blanks a Turnier format with its own reason, not "provisional"', () => {
    const mu10 = Object.keys(KSCW_TEAM_GROUP).find((id) => KSCW_TEAM_GROUP[id] === 'MixU10')
    expect(mu10).toBeDefined()
    expect(homeGamesFor(mu10).reason).toBe('tournament')
  })

  it('reports no_group for a team ProBasket has no group for', () => {
    const r = homeGamesFor('999999')
    expect(r.count).toBeNull()
    expect(r.reason).toBe('no_group')
    expect(r.groupCode).toBeNull()
  })

  it('treats null/undefined as no_group instead of throwing', () => {
    expect(homeGamesFor(null).reason).toBe('no_group')
    expect(homeGamesFor(undefined).reason).toBe('no_group')
  })
})

describe('the DU18 derby is counted, not filtered away', () => {
  it('uses the full group size, so the sibling squad still counts as an opponent', () => {
    // DU18/U20 Rookie lists BOTH "KSC Wiedikon DU18 A" and "DU18 B". `opponentEntriesFor` strips
    // every KSCW entry and would return 10 of the 12, but DU18 A really does play DU18 B home and
    // away — hence size-1 (11), not opponents.length (10). The group is provisional today so no
    // count is emitted, yet the SIZE the arithmetic would use must include both.
    expect(KSCW_TEAM_GROUP[DU18_A]).toBe('DU18/U20 Rookie')
    const group = BB_GROUPS['DU18/U20 Rookie']
    expect(group.teams.filter((t) => /wiedikon/i.test(t.name))).toHaveLength(2)
    expect(homeGamesFor(DU18_A).groupSize).toBe(group.teams.length)
  })

  it('keeps 7182 in the DU16 group despite the team row being named "2xDU18"', () => {
    // A local misnomer: the active team row reads "2xDU18" but Basketplan fixtures for 7182 show
    // it playing DU16, and teams.league is "DU16B". Anyone "fixing" this to a DU18 group would
    // silently re-scope its opponents and its availability export.
    expect(KSCW_TEAM_GROUP[DU18_B]).toBe('DU14/U16 Rookie')
    expect(homeGamesFor(DU18_B).groupCode).toBe('DU14/U16 Rookie')
  })
})

describe('the classification table stays in step with the group data', () => {
  it('names a status for every BB_GROUPS key', () => {
    const missing = Object.keys(BB_GROUPS).filter((k) => !(k in groupFormat.groups))
    expect(missing).toEqual([])
  })

  it('names no group that BB_GROUPS does not have', () => {
    const stale = Object.keys(groupFormat.groups).filter((k) => !(k in BB_GROUPS))
    expect(stale).toEqual([])
  })

  it('defaults an unknown key to provisional, never to championship', () => {
    expect(groupStatusOf('NOT_A_GROUP')).toBe('provisional')
    expect(groupStatusOf(null)).toBe('provisional')
  })
})
