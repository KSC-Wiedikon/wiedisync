/**
 * Car pooling (migration 378) — the pure halves of carpools.js: input
 * validation, Postgres-error mapping, activity description and the board
 * builder (seat maths, request coverage, and that no phone number ever leaves).
 */
import { describe, it, expect } from 'vitest'
import { parseEntryInput, normalizeTime, mapCarpoolError, describeActivity, buildBoard, zurichToday, parseScope, scopeAllows, effectiveScope } from '../carpools.js'

describe('normalizeTime', () => {
  it('accepts 24h clocks and drops seconds', () => {
    expect(normalizeTime('07:05')).toBe('07:05')
    expect(normalizeTime('23:59:30')).toBe('23:59')
  })
  it('refuses anything else', () => {
    for (const bad of ['24:00', '7:05', '12:60', 'noon', '', null]) expect(normalizeTime(bad)).toBeNull()
  })
})

describe('parseEntryInput', () => {
  it('cleans a full offer', () => {
    expect(parseEntryInput({ kind: 'offer', seats: '3', direction: 'there', departure_time: '16:45:00', departure_location: '  Bhf   Wiedikon ', notes: '' }))
      .toEqual({ kind: 'offer', seats: 3, direction: 'there', departure_time: '16:45', return_time: null, teams: null, departure_location: 'Bhf Wiedikon', notes: null })
  })
  it('defaults a request to one seat, both ways, no time', () => {
    expect(parseEntryInput({ kind: 'request' }))
      .toEqual({ kind: 'request', seats: 1, direction: 'both', departure_time: null, return_time: null, teams: null, departure_location: null, notes: null })
  })
  it('refuses bad kinds, seats, directions and times with a 400', () => {
    for (const body of [
      { kind: 'lift' },
      { kind: 'request', seats: 0 },
      { kind: 'request', seats: 9 },
      { kind: 'request', seats: 1.5 },
      { kind: 'request', direction: 'sideways' },
      { kind: 'request', departure_time: '25:00' },
    ]) {
      expect(() => parseEntryInput(body)).toThrow()
      try { parseEntryInput(body) } catch (e) { expect(e.status).toBe(400) }
    }
  })
  it('needs a meeting point on an offer', () => {
    expect(() => parseEntryInput({ kind: 'offer', seats: 2 })).toThrow(/meeting point/)
  })
  it('PATCH validates only what is sent and never changes the kind', () => {
    expect(parseEntryInput({ seats: 4, kind: 'request' }, { partial: true })).toEqual({ seats: 4 })
    expect(parseEntryInput({ departure_time: '' }, { partial: true })).toEqual({ departure_time: null })
  })
})

describe('mapCarpoolError', () => {
  it('turns trigger exceptions into 409s with a stable code', () => {
    for (const code of ['carpool_full', 'carpool_seats_below_taken', 'carpool_driver_is_passenger']) {
      const e = mapCarpoolError(new Error(`error: ${code}`))
      expect(e.status).toBe(409)
      expect(e.code).toBe(code)
    }
  })
  it('maps unique violations', () => {
    expect(mapCarpoolError({ code: '23505', message: 'duplicate key value violates unique constraint "carpool_passengers_pair_uq"' }).code)
      .toBe('carpool_already_passenger')
    expect(mapCarpoolError({ code: '23505', message: 'carpools_game_member_kind_uq' }).code).toBe('carpool_duplicate')
  })
  it('passes anything else through untouched', () => {
    const e = new Error('boom')
    expect(mapCarpoolError(e)).toBe(e)
  })
})

describe('describeActivity', () => {
  const today = '2026-10-01'
  it('labels a game and closes it once played or cancelled', () => {
    const g = { id: 5, date: '2026-10-03', time: '18:00:00', status: 'scheduled', home_team: 'VBC X', away_team: 'KSCW H1', carpool_enabled: true }
    expect(describeActivity('game', g, { today })).toMatchObject({ label: 'VBC X – KSCW H1', date: '2026-10-03', time: '18:00', open: true })
    expect(describeActivity('game', { ...g, date: '2026-09-30' }, { today }).open).toBe(false)
    expect(describeActivity('game', { ...g, status: 'cancelled' }, { today }).open).toBe(false)
    expect(describeActivity('game', { ...g, carpool_enabled: false }, { today }).open).toBe(false)
  })
  it('keeps a multi-day event open until its last day, in Zurich time', () => {
    const e = { id: 1, title: 'Turnier', start_date: new Date('2026-09-29T22:30:00Z'), end_date: new Date('2026-10-01T16:00:00Z'), carpool_enabled: true }
    const d = describeActivity('event', e, { today })
    expect(d.date).toBe('2026-09-30') // 00:30 Zurich, not the UTC day
    expect(d.time).toBe('00:30')
    expect(d.open).toBe(true)
    expect(describeActivity('event', { ...e, all_day: true }, { today }).time).toBeNull()
  })
  it('names a training after its team', () => {
    expect(describeActivity('training', { id: 2, date: '2026-10-02', start_time: '19:00:00', cancelled: false, carpool_enabled: true }, { teamName: 'Herren 1', today }))
      .toMatchObject({ label: 'Herren 1', time: '19:00', open: true })
  })
})

describe('zurichToday', () => {
  it('uses the Zurich calendar day', () => {
    expect(zurichToday(new Date('2026-06-30T22:30:00Z'))).toBe('2026-07-01')
  })
})

describe('buildBoard', () => {
  const m = (id, extra = {}) => ({ m_id: id, m_first_name: `F${id}`, m_last_name: `L${id}`, m_nickname: null, m_phone: `+41 79 ${id}`, m_hide_phone: false, ...extra })
  const pax = (id, carpool, passenger, seats = 1, extra = {}) => ({ id, carpool, passenger, seats, p_id: passenger, p_first_name: `F${passenger}`, p_last_name: `L${passenger}`, p_nickname: null, p_phone: `+41 79 ${passenger}`, p_hide_phone: false, ...extra })
  const entries = [
    { id: 10, kind: 'offer', member: 1, seats: 3, direction: 'both', departure_time: '16:45:00', departure_location: 'HB', ...m(1) },
    { id: 11, kind: 'offer', member: 2, seats: 2, direction: 'there', departure_time: '16:30:00', departure_location: 'Wiedikon', ...m(2, { m_hide_phone: true }) },
    { id: 12, kind: 'request', member: 3, seats: 2, direction: 'there', ...m(3) },
    { id: 13, kind: 'request', member: 4, seats: 1, direction: 'both', ...m(4) },
  ]
  const passengers = [pax(100, 10, 3, 2), pax(101, 11, 5, 1, { p_hide_phone: true })]

  it('computes seats and marks covered requests', () => {
    const b = buildBoard(entries, passengers, null)
    const o10 = b.offers.find((o) => o.id === 10)
    expect(o10).toMatchObject({ seats_taken: 2, seats_free: 1 })
    expect(b.offers.map((o) => o.id)).toEqual([11, 10]) // by departure time
    expect(b.requests.map((r) => [r.id, r.covered])).toEqual([[13, false], [12, true]]) // open first
    expect(b.requests.find((r) => r.id === 12).covered_by[0].id).toBe(1)
    expect(b.totals).toEqual({ offers: 2, seats_free: 2, requests_open: 1 })
  })

  it('tracks my own role: driver, rider, requester', () => {
    const driver = buildBoard(entries, passengers, 1)
    expect(driver.offers.find((o) => o.id === 10).mine).toBe(true)
    expect(driver.mine).toEqual({ offer: 10, request: null, riding_in: [] })
    const rider = buildBoard(entries, passengers, 3)
    expect(rider.mine.riding_in).toEqual([10])
    expect(rider.mine.request).toBe(12)
  })

  it('never carries a phone number — not even between driver and passengers', () => {
    // The rows below DO carry phones (as a careless query would); none may leak.
    for (const me of [null, 1, 2, 3, 4, 5]) {
      const json = JSON.stringify(buildBoard(entries, passengers, me))
      expect(json).not.toContain('phone')
      expect(json).not.toContain('+41')
    }
  })
})

describe('scope (migration 379)', () => {
  it('parses jsonb arrays and their JSON text, dropping junk and duplicates', () => {
    expect(parseScope([3, '9', 3, 0, -1, 'x', null])).toEqual([3, 9])
    expect(parseScope('[4,"5"]')).toEqual([4, 5])
    expect(parseScope(null)).toEqual([])
    expect(parseScope('{"a":1}')).toEqual([])
  })
  it('an empty scope is open to everyone; otherwise any shared team lets you in', () => {
    expect(scopeAllows([], [])).toBe(true)
    expect(scopeAllows([3, 9], [1, 9])).toBe(true)
    expect(scopeAllows([3, 9], ['9'])).toBe(true)
    expect(scopeAllows([3, 9], [1, 2])).toBe(false)
    expect(scopeAllows([3], [])).toBe(false)
  })
  it('describeActivity carries the scope', () => {
    expect(describeActivity('game', { id: 1, date: '2026-10-03', carpool_enabled: true, carpool_teams: [3, 9] }, { today: '2026-10-01' }).scope).toEqual([3, 9])
    expect(describeActivity('training', { id: 1, date: '2026-10-03', carpool_enabled: true }, { today: '2026-10-01' }).scope).toEqual([])
  })
})

describe('per-offer teams + return time (migration 380)', () => {
  it('keeps a return time only on a there-and-back ride', () => {
    expect(parseEntryInput({ kind: 'offer', direction: 'both', departure_time: '08:00', return_time: '18:30:00', departure_location: 'HB' }).return_time).toBe('18:30')
    expect(parseEntryInput({ kind: 'offer', direction: 'there', return_time: '18:30', departure_location: 'HB' }).return_time).toBeNull()
    expect(() => parseEntryInput({ kind: 'offer', direction: 'both', return_time: '25:00', departure_location: 'HB' })).toThrow(/return_time/)
    expect(parseEntryInput({ direction: 'back' }, { partial: true })).toEqual({ direction: 'back', return_time: null })
  })
  it('stores an offer\'s teams as a JSON list, never on a request', () => {
    expect(parseEntryInput({ kind: 'offer', teams: [3, '9', 3], departure_location: 'HB' }).teams).toBe('[3,9]')
    expect(parseEntryInput({ kind: 'offer', teams: [], departure_location: 'HB' }).teams).toBeNull()
    expect(parseEntryInput({ kind: 'request', teams: [3] }).teams).toBeNull()
  })
  it('hides an offer for other teams unless it is mine, I ride in it, or I am admin', () => {
    const m = (id) => ({ m_id: id, m_first_name: 'F', m_last_name: 'L', m_nickname: null, m_phone: null, m_hide_phone: false })
    const entries = [
      { id: 1, kind: 'offer', member: 1, seats: 3, direction: 'both', departure_time: '08:00:00', return_time: '18:00:00', teams: [3], ...m(1) },
      { id: 2, kind: 'offer', member: 2, seats: 2, direction: 'there', teams: null, ...m(2) },
    ]
    const pax = [{ id: 10, carpool: 1, passenger: 7, seats: 1, p_id: 7, p_first_name: 'P', p_last_name: 'Q', p_nickname: null, p_phone: null, p_hide_phone: false }]
    expect(buildBoard(entries, pax, 5, { myTeams: [9] }).offers.map((o) => o.id)).toEqual([2])
    expect(buildBoard(entries, pax, 5, { myTeams: [3] }).offers.map((o) => o.id)).toEqual([1, 2])
    expect(buildBoard(entries, pax, 1, { myTeams: [] }).offers.map((o) => o.id)).toEqual([1, 2])
    expect(buildBoard(entries, pax, 7, { myTeams: [] }).offers.map((o) => o.id)).toEqual([1, 2])
    expect(buildBoard(entries, pax, null, { admin: true }).offers.length).toBe(2)
    const o = buildBoard(entries, pax, 1).offers.find((x) => x.id === 1)
    expect(o).toMatchObject({ return_time: '18:00', teams: [3] })
    expect(buildBoard(entries, pax, 5, { myTeams: [9] }).totals.seats_free).toBe(2)
  })
})

describe('effectiveScope (audit 2026-09-28 F21)', () => {
  it('an explicit scope wins for every type', () => {
    expect(effectiveScope('game', [4], [1, 2])).toEqual([4])
    expect(effectiveScope('event', [4])).toEqual([4])
  })
  it('an unscoped game is for its own team + guest teams, not the whole club', () => {
    expect(effectiveScope('game', [], [1, 2])).toEqual([1, 2])
    expect(scopeAllows(effectiveScope('game', [], [1, 2]), [9])).toBe(false)
    expect(scopeAllows(effectiveScope('game', [], [1, 2]), [2])).toBe(true)
  })
  it('an unscoped training is for its own team (cuts a stale seat on an archived team)', () => {
    expect(effectiveScope('training', [], [7])).toEqual([7])
    expect(scopeAllows(effectiveScope('training', [], [7]), [3])).toBe(false)
    expect(scopeAllows(effectiveScope('training', [], [7]), [7])).toBe(true)
  })
  it('unscoped events (policy-scoped already) and team-less games/trainings stay open', () => {
    expect(effectiveScope('training', [], [])).toBeNull()
    expect(effectiveScope('event', [], [])).toBeNull()
    expect(effectiveScope('game', [], [])).toBeNull()
  })
})
