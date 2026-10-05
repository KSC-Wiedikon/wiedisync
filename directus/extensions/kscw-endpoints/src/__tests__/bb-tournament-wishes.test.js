import { describe, it, expect } from 'vitest'
import { avoided, matchWishes, waitingWishes, weekStart, wishState, zurichHour } from '../bb-tournament-wishes.js'
import { buildWishes, cleanAvoid } from '../bb-tournament-picks.js'
import { inWatchHours } from '../bb-tournament-worker.js'

const MU10 = { id: 87, league: 'MixU10M', bb_source_id: '5287', hidden: false, avoid: ['Schaffhausen'] }
const tour = (id, date, extra = {}) => ({
  id, date, end_date: null, host_club: `Club ${id}`, hall: 'Halle', leagues: ['MixU10M', 'MixU12M'],
  deadline: '2027-03-01', registration_open: true, kscw_bp_team_ids: [], ...extra,
})
const ctx = (over = {}) => ({
  wishes: [{ id: 1, team: 87, week_start: '2027-03-08' }],
  teams: new Map([[87, MU10]]),
  tournaments: [],
  picks: [],
  attempts: [],
  today: '2026-11-02',
  ...over,
})

describe('bb tournament weekend wishes', () => {
  it('normalises any day to the Monday of its week', () => {
    expect(weekStart('2027-03-13')).toBe('2027-03-08') // Saturday
    expect(weekStart('2027-03-14')).toBe('2027-03-08') // Sunday
    expect(weekStart('2027-03-08')).toBe('2027-03-08')
    expect(weekStart('nope')).toBeNull()
    expect(weekStart(undefined)).toBeNull()
  })

  it('matches places to avoid on host club or hall, ignoring case and accents', () => {
    expect(avoided({ host_club: 'BC Schaffhausen', hall: 'x' }, ['schaffhausen'])).toBe(true)
    expect(avoided({ host_club: 'BC Zürich', hall: 'Saalsporthalle' }, ['zurich'])).toBe(true)
    expect(avoided({ host_club: 'BC Opfikon', hall: 'Halle Glattpark' }, ['Schaffhausen'])).toBe(false)
    expect(avoided({ host_club: 'A', hall: 'B' }, ['a'])).toBe(false) // one letter matches everything
  })

  it('picks the first open, fitting tournament of the wished week', () => {
    const c = ctx({ tournaments: [tour(502, '2027-03-14'), tour(501, '2027-03-13'), tour(500, '2027-03-06')] })
    expect(matchWishes(c)).toEqual([{ wish: 1, team: 87, tournament: 501 }])
  })

  it('skips places to avoid, closed sign-ups, other leagues and past deadlines', () => {
    const c = ctx({
      tournaments: [
        tour(510, '2027-03-13', { host_club: 'BC Schaffhausen' }),
        tour(511, '2027-03-13', { registration_open: false }),
        tour(512, '2027-03-13', { leagues: ['DU12Tu'] }),
        tour(513, '2027-03-13', { deadline: '2026-10-01' }),
      ],
    })
    expect(matchWishes(c)).toEqual([])
    expect(waitingWishes(c)).toHaveLength(1)
  })

  it('a registration or a live pick that week covers the wish', () => {
    const reg = ctx({ tournaments: [tour(520, '2027-03-14', { kscw_bp_team_ids: ['5287'] }), tour(521, '2027-03-13')] })
    expect(matchWishes(reg)).toEqual([])
    expect(waitingWishes(reg)).toEqual([])

    const picked = ctx({ tournaments: [tour(521, '2027-03-13'), tour(522, '2027-03-14')], picks: [{ tournament: 522, team: 87 }] })
    expect(matchWishes(picked)).toEqual([])
  })

  it('a pick Basketplan refused frees the week for the next tournament', () => {
    const c = ctx({
      tournaments: [tour(530, '2027-03-13'), tour(531, '2027-03-14')],
      picks: [{ tournament: 530, team: 87 }],
      attempts: [{ tournament: 530, team: 87, result: 'not_offered' }],
    })
    expect(matchWishes(c)).toEqual([{ wish: 1, team: 87, tournament: 531 }])
  })

  it('ignores hidden teams and past weeks', () => {
    const hidden = ctx({ teams: new Map([[87, { ...MU10, hidden: true }]]), tournaments: [tour(540, '2027-03-13')] })
    expect(matchWishes(hidden)).toEqual([])
    const past = { id: 2, team: 87, week_start: '2026-10-19' }
    expect(wishState(past, MU10, [], new Map(), new Map(), '2026-11-02').state).toBe('past')
  })

  it('reports each wish with its state for the page', () => {
    const teams = [{ id: 87, league: 'MixU10M', bb_source_id: '5287' }]
    const wishes = [
      { id: 2, team: 87, week_start: '2027-03-15', wished_by_name: 'Coach' },
      { id: 1, team: 87, week_start: '2027-03-08', wished_by_name: 'Coach' },
      { id: 3, team: 87, week_start: '2026-10-19', wished_by_name: 'Coach' },
    ]
    const out = buildWishes(wishes, teams, [tour(550, '2027-03-13', { kscw_bp_team_ids: ['5287'] })], [], [], '2026-11-02')
    expect(out.map((w) => [w.id, w.state])).toEqual([[1, 'registered'], [2, 'waiting']])
    expect(out[0].tournament).toEqual({ id: 550, date: '2027-03-13', host_club: 'Club 550' })
  })

  it('cleans the places-to-avoid list', () => {
    expect(cleanAvoid(['  Schaffhausen ', 'schaffhausen', 'x', 'Basel'])).toEqual(['Schaffhausen', 'Basel'])
    expect(cleanAvoid('Basel')).toBeNull()
  })

  it('watches between 07:00 and 22:00 Zurich time', () => {
    expect(zurichHour(new Date('2026-11-02T06:30:00Z'))).toBe(7) // CET
    expect(inWatchHours(new Date('2026-11-02T05:59:00Z'))).toBe(false)
    expect(inWatchHours(new Date('2026-11-02T06:00:00Z'))).toBe(true)
    expect(inWatchHours(new Date('2026-11-02T20:59:00Z'))).toBe(true)
    expect(inWatchHours(new Date('2026-11-02T21:00:00Z'))).toBe(false)
  })
})
