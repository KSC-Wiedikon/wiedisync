/**
 * Volleymanager result reports (vm-game-result.js) — the pure halves: the set-ball
 * converter and the response parser. The fixture is cut down from a recorded browser
 * session (2026-09-28, an away game where the home team had reported 3:2) with every
 * username, IP address and person id removed.
 */
import { describe, it, expect } from 'vitest'
import { reportToSets, parseGameResult, showUrlPath, partyMayReport } from '../vm-game-result.js'

const REPORT = {
  __identity: 'rep-home-0001',
  reportingPartyType: 'hometeam',
  deletedAt: null,
  neededSetsToWin: 3,
  updatedAt: '2026-09-28T21:57:24.000000+00:00',
  homeTeamSet1Balls: 25, awayTeamSet1Balls: 27,
  homeTeamSet2Balls: 25, awayTeamSet2Balls: 21,
  homeTeamSet3Balls: 25, awayTeamSet3Balls: 18,
  homeTeamSet4Balls: 20, awayTeamSet4Balls: 25,
  homeTeamSet5Balls: 15, awayTeamSet5Balls: 12,
  homeTeamGoldenSetBalls: null, awayTeamGoldenSetBalls: null,
  gameResultReportValidation: { hasValidationIssues: false, totalPlayedSets: 5, __identity: 'val-0001' },
  summarizedSets: '25:27, 25:21, 25:18, 20:25, 15:12',
  wonSetsHomeTeam: 3, wonSetsAwayTeam: 2,
}

const SHOW = {
  game: {
    _permissions: {
      object: { create: true, update: true, delete: true },
      properties: { gameResultReports: { create: true, read: true, update: true, required: false } },
    },
    __identity: 'game-uuid-0001',
    number: 406208,
    status: 'approved',
    isGameResultReported: false,
    result: null,
    gameResultReports: [REPORT],
    group: {
      phase: {
        league: {
          name: '2L',
          numberOfWinSets: 'three_win_sets',
          resultNotificationSystem: { identifier: 'bothteams', active: true },
        },
      },
    },
  },
}

describe('reportToSets', () => {
  it('reads five sets and counts sets won', () => {
    expect(reportToSets(REPORT)).toEqual({
      sets: [
        { home: 25, away: 27 }, { home: 25, away: 21 }, { home: 25, away: 18 },
        { home: 20, away: 25 }, { home: 15, away: 12 },
      ],
      home: 3,
      away: 2,
    })
  })
  it('stops at unplayed (null) sets — the official result shape too', () => {
    const result = {
      homeTeamSet1Balls: 25, awayTeamSet1Balls: 23, homeTeamSet2Balls: 25, awayTeamSet2Balls: 15,
      homeTeamSet3Balls: 25, awayTeamSet3Balls: 21, homeTeamSet4Balls: null, awayTeamSet4Balls: null,
      homeTeamSet5Balls: null, awayTeamSet5Balls: null, wonSetsHomeTeam: 3, wonSetsAwayTeam: 0,
    }
    expect(reportToSets(result)).toEqual({
      sets: [{ home: 25, away: 23 }, { home: 25, away: 15 }, { home: 25, away: 21 }], home: 3, away: 0,
    })
  })
  it('is null for nothing entered', () => {
    expect(reportToSets(null)).toBeNull()
    expect(reportToSets({ homeTeamSet1Balls: null, awayTeamSet1Balls: null })).toBeNull()
  })
})

describe('parseGameResult', () => {
  it('parses the recorded response', () => {
    expect(parseGameResult(SHOW, 'awayteam')).toEqual({
      reportable: true,
      needed_sets: 3,
      notification_system: 'bothteams',
      official: null,
      reports: [{
        id: 'rep-home-0001',
        party: 'hometeam',
        sets: reportToSets(REPORT).sets,
        home: 3,
        away: 2,
        updated_at: '2026-09-28T21:57:24.000000+00:00',
      }],
      own_party: 'awayteam',
    })
  })
  it('reads not-reportable, the official result and two_win_sets', () => {
    const show = structuredClone(SHOW)
    show.game._permissions.properties.gameResultReports.create = false
    show.game.result = { homeTeamSet1Balls: 25, awayTeamSet1Balls: 10, homeTeamSet2Balls: 25, awayTeamSet2Balls: 10 }
    show.game.group.phase.league.numberOfWinSets = 'two_win_sets'
    const r = parseGameResult(show, 'hometeam')
    expect(r.reportable).toBe(false)
    expect(r.needed_sets).toBe(2)
    expect(r.official).toEqual({ sets: [{ home: 25, away: 10 }, { home: 25, away: 10 }], home: 2, away: 0 })
  })
  it('falls back to a report\'s neededSetsToWin when the league has none', () => {
    const show = structuredClone(SHOW)
    delete show.game.group.phase.league.numberOfWinSets
    expect(parseGameResult(show, null).needed_sets).toBe(3)
  })
  it('drops deleted reports and unknown parties, and an unknown own party', () => {
    const show = structuredClone(SHOW)
    show.game.gameResultReports.push({ ...REPORT, __identity: 'x', deletedAt: '2026-09-28T22:00:00Z' })
    show.game.gameResultReports.push({ ...REPORT, __identity: 'y', reportingPartyType: '' })
    const r = parseGameResult(show, '<html>login</html>')
    expect(r.reports.map((x) => x.id)).toEqual(['rep-home-0001'])
    expect(r.own_party).toBeNull()
  })
  it('refuses a body that is not a game', () => {
    expect(parseGameResult(null, null)).toBeNull()
  })
})

it('builds the showWithNestedObjects query like the browser does', () => {
  const p = showUrlPath('game-uuid-0001')
  expect(p.startsWith('api%5cgame/showWithNestedObjects?')).toBe(true)
  expect(p).toContain('propertyRenderConfiguration%5B0%5D=gameResultReports.*.gameResultReportValidation')
  expect(p).toContain('propertyRenderConfiguration%5B5%5D=group.phase.league.numberOfWinSets')
  expect(p.endsWith('game%5B__identity%5D=game-uuid-0001')).toBe(true)
})

describe('reportable — our party\'s flags, the permission bit only as an extra AND', () => {
  // The recorded response says create:true on EVERY property, so _permissions alone
  // cannot tell a closed reporting round from an open one. The flags are in the
  // default response (HAR entry 48) — no extra propertyRenderConfiguration needed.
  const withFlags = (over) => {
    const show = structuredClone(SHOW)
    Object.assign(show.game, {
      homeTeamGameResultReportDeadlineExceeded: false, awayTeamGameResultReportDeadlineExceeded: false, ...over,
    })
    return show
  }
  it('our deadline closes it, the other side\'s does not', () => {
    expect(parseGameResult(withFlags({ awayTeamGameResultReportDeadlineExceeded: true }), 'awayteam').reportable).toBe(false)
    expect(parseGameResult(withFlags({ homeTeamGameResultReportDeadlineExceeded: true }), 'awayteam').reportable).toBe(true)
    expect(parseGameResult(withFlags({ homeTeamGameResultReportDeadlineExceeded: true }), 'hometeam').reportable).toBe(false)
  })
  it('"reported" with no official result closes it; with one it is the official branch', () => {
    expect(parseGameResult(withFlags({ isGameResultReported: true }), 'awayteam').reportable).toBe(false)
    const official = { homeTeamSet1Balls: 25, awayTeamSet1Balls: 10, homeTeamSet2Balls: 25, awayTeamSet2Balls: 10 }
    expect(partyMayReport({ ...SHOW.game, isGameResultReported: true }, 'awayteam', reportToSets(official))).toBe(true)
  })
  it('a permission that says no still means no', () => {
    const show = withFlags({})
    show.game._permissions.properties.gameResultReports.create = false
    expect(parseGameResult(show, 'awayteam').reportable).toBe(false)
  })
  it('an unknown party gets only the party-independent checks', () => {
    expect(parseGameResult(withFlags({ awayTeamGameResultReportDeadlineExceeded: true }), null).reportable).toBe(true)
    expect(parseGameResult(withFlags({ isGameResultReported: true }), null).reportable).toBe(false)
  })
})
