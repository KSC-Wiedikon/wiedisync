/**
 * The Swiss Volley Game Center client (game-center.js) and the standings
 * groups sv-sync derives from the club's season (sv-sync.js → standingsGroups).
 *
 * Hermetic: every call goes to a fake fetch. Shapes are the live ones (checked
 * 27.11.2026 against svrz.ch); teams, referees and halls are invented.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { flightValue, seasonWindow, fetchClubSeasonGames, fetchStandings, __setActionId } from '../game-center.js'

const { standingsGroups, KSCW_CLUB_ID } = await import('../sv-sync.js')

/** A server-action answer the way svrz.ch sends it: React flight lines. */
const flight = (value) => `0:["$@1",["build",null]]\n1:${JSON.stringify(value)}\n`
const game = (over = {}) => ({
  gameId: 999001, playDate: '2026-11-02 20:00:00',
  teams: { home: { teamId: 1393, caption: 'KSC Wiedikon D1', clubId: 912530 }, away: { teamId: 626, caption: 'Test Away D1', clubId: 1 } },
  league: { leagueId: 7138, caption: '2L', season: 2026 }, phase: { phaseId: 14084, caption: 'Vor- & Rückrunde' },
  group: { groupId: 29546, caption: 'Frauen 2. Liga' },
  resultSummary: { wonSetsHomeTeam: 1, wonSetsAwayTeam: 3, winner: 'team_away' },
  ...over,
})
const row = (over = {}) => ({ rank: 1, teamId: 1393, teamCaption: 'KSC Wiedikon D1', games: 7, points: 20, ...over })

beforeEach(() => { __setActionId('games', 'a'.repeat(40)); __setActionId('standings', 'b'.repeat(40)) })

describe('flight answers', () => {
  it('reads line 1', () => expect(flightValue(flight([1, 2]))).toEqual([1, 2]))
  it('anything else is undefined', () => {
    expect(flightValue('0:["$@1",["b",null]]\n1:E{"digest":"1"}\n')).toBeUndefined()
    expect(flightValue('<html></html>')).toBeUndefined()
  })
})

describe('season window', () => {
  it('runs 1 August to 1 August', () => {
    expect(seasonWindow(new Date('2026-11-27T12:00:00Z'))).toEqual(['2026-08-01', '2027-08-01'])
    expect(seasonWindow(new Date('2027-03-01T12:00:00Z'))).toEqual(['2026-08-01', '2027-08-01'])
    expect(seasonWindow(new Date('2027-08-02T12:00:00Z'))).toEqual(['2027-08-01', '2028-08-01'])
  })
})

describe('club season', () => {
  it('asks for the club, cups included, over the season — one call', async () => {
    const asked = []
    const fake = async (_url, init) => { asked.push(JSON.parse(init.body)[0]); return new Response(flight([game()])) }
    const games = await fetchClubSeasonGames(KSCW_CLUB_ID, { now: new Date('2026-11-27T12:00:00Z'), fetchImpl: fake })
    expect(games).toHaveLength(1)
    expect(asked).toEqual(['?clubId=912530&includeCup=1&dateStart=2026-08-01&dateEnd=2027-08-01'])
  })

  it('a failed read throws instead of looking like an empty season', async () => {
    const fake = async (url, init) => init?.method === 'POST' ? new Response('', { status: 503 }) : new Response('<html></html>')
    await expect(fetchClubSeasonGames(KSCW_CLUB_ID, { fetchImpl: fake })).rejects.toThrow()
  })

  it('finds the games action again after a svrz.ch redeploy', async () => {
    const NEW = 'c'.repeat(40), OTHER = 'd'.repeat(40)
    const fake = async (url, init) => {
      if (init?.method === 'POST') {
        const id = init.headers['Next-Action']
        if (id === NEW) return new Response(flight([game()]))
        if (id === OTHER) return new Response(flight([])) // another action, empty answer
        return new Response('', { status: 404 })
      }
      if (String(url).endsWith('/game-center')) return new Response('<script src="/_next/static/chunks/854-x.js"></script>')
      return new Response(`var c=(0,l.$)("${OTHER}"),d=(0,l.$)("${NEW}");`)
    }
    expect(await fetchClubSeasonGames(KSCW_CLUB_ID, { fetchImpl: fake })).toHaveLength(1)
  })
})

describe('standings', () => {
  it('a group answers its table', async () => {
    const fake = async () => new Response(flight([row(), row({ rank: 2, teamId: 5 })]))
    expect(await fetchStandings(29546, 29546, { fetchImpl: fake })).toHaveLength(2)
  })
  it('an empty table is a valid answer, not a reason to go looking for the action', async () => {
    let posts = 0
    const fake = async (_url, init) => { if (init?.method === 'POST') posts++; return new Response(flight([])) }
    expect(await fetchStandings(30137, 29546, { fetchImpl: fake })).toEqual([])
    expect(posts).toBe(1)
  })
})

describe('standingsGroups', () => {
  it('every league group a KSCW team plays in, once, with its phase and league', () => {
    const games = [
      game(),
      game({ gameId: 2 }), // same group again
      game({ gameId: 3, group: { groupId: 29531, caption: 'Männer 2. Liga' }, teams: { home: { teamId: 2743 }, away: { teamId: 80 } } }),
    ]
    expect(standingsGroups(games)).toEqual([
      { groupId: 29546, phaseId: 14084, leagueId: 7138 },
      { groupId: 29531, phaseId: 14084, leagueId: 7138 },
    ])
  })
  it('skips cup rounds (no table) and groups without a KSCW team', () => {
    const games = [
      game({ league: { leagueId: 1, caption: 'Züri Cup' }, group: { groupId: 30137, caption: 'Runde 2, Spiel 3' } }),
      game({ league: { leagueId: 2, caption: 'Mobiliar Volley Cup' }, group: { groupId: 29920 } }),
      game({ teams: { home: { teamId: 80 }, away: { teamId: 626 } }, group: { groupId: 1 } }),
    ]
    expect(standingsGroups(games)).toEqual([])
  })
})
