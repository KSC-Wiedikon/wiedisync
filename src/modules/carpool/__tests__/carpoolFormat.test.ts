import { describe, it, expect } from 'vitest'
import type { CarpoolLeg, CarpoolOffer, CarpoolRequest } from '../carpoolApi'
import { activityDays, canJoin, canOffer, canRequest, canTake, entryCount, firstFreeDay, inCarpoolScope, myRideDays, myRole, seatsINeed } from '../carpoolFormat'

const person = (id: number) => ({ id, first_name: `F${id}`, last_name: `L${id}`, nickname: null })

function offer(id: number, driver: number, seats: number, taken: number, extra: Partial<CarpoolOffer> = {}): CarpoolOffer {
  return {
    id, kind: 'offer', member: person(driver), direction: 'there', seats, departure_date: '2026-10-03', departure_time: '16:45', teams: [], departure_location: 'HB',
    notes: null, mine: false, seats_taken: taken, seats_free: seats - taken, i_am_passenger: false, passengers: [], ...extra,
  }
}
function request(id: number, who: number, seats: number, extra: Partial<CarpoolRequest> = {}): CarpoolRequest {
  return {
    id, kind: 'request', member: person(who), direction: 'there', seats, departure_date: null, departure_time: null, teams: [], departure_location: null,
    notes: null, mine: false, covered: false, covered_by: [], ...extra,
  }
}
function board(offers: CarpoolOffer[], requests: CarpoolRequest[]): CarpoolLeg {
  return {
    offers, requests,
    totals: { offers: offers.length, seats_free: offers.reduce((s, o) => s + o.seats_free, 0), requests_open: requests.filter((r) => !r.covered).length },
    mine: {
      offer: offers.find((o) => o.mine)?.id ?? null,
      request: requests.find((r) => r.mine)?.id ?? null,
      riding_in: offers.filter((o) => o.i_am_passenger).map((o) => o.id),
    },
  }
}

describe('car pooling viewer rules', () => {
  it('a bystander can offer, request and join a car with room', () => {
    const b = board([offer(1, 10, 3, 1)], [])
    expect(canOffer(b, true)).toBe(true)
    expect(canRequest(b, true)).toBe(true)
    expect(canJoin(b, b.offers[0], true)).toBe(true)
    expect(myRole(b)).toBeNull()
  })

  it('nothing is possible once the board is closed', () => {
    const b = board([offer(1, 10, 3, 1)], [request(2, 11, 1)])
    expect(canOffer(b, false)).toBe(false)
    expect(canRequest(b, false)).toBe(false)
    expect(canJoin(b, b.offers[0], false)).toBe(false)
  })

  it('joining takes the seats I asked for, and needs that many free', () => {
    const b = board([offer(1, 10, 3, 2)], [request(2, 5, 2, { mine: true })])
    expect(seatsINeed(b)).toBe(2)
    expect(canJoin(b, b.offers[0], true)).toBe(false) // only one seat left
    expect(myRole(b)).toBe('requester')
    expect(canRequest(b, true)).toBe(false) // already requested
  })

  it('a driver takes requests that fit, not their own seat', () => {
    const b = board([offer(1, 5, 2, 0, { mine: true })], [request(2, 11, 2), request(3, 12, 3), request(4, 13, 1, { covered: true })])
    expect(myRole(b)).toBe('driver')
    expect(canTake(b, b.requests[0], true)).toBe(true)
    expect(canTake(b, b.requests[1], true)).toBe(false) // needs 3, car has 2
    expect(canTake(b, b.requests[2], true)).toBe(false) // already has a ride
    expect(canJoin(b, b.offers[0], true)).toBe(false) // own car
    expect(canRequest(b, true)).toBe(false)
    expect(canOffer(b, true)).toBe(false)
  })

  it('a passenger neither offers nor requests nor joins a second car', () => {
    const b = board([offer(1, 10, 3, 1, { i_am_passenger: true }), offer(2, 11, 3, 0)], [])
    expect(myRole(b)).toBe('passenger')
    expect(canOffer(b, true)).toBe(false)
    expect(canRequest(b, true)).toBe(false)
    expect(canJoin(b, b.offers[0], true)).toBe(false)
    expect(canJoin(b, b.offers[1], true)).toBe(true) // may still switch cars
  })
})

describe('Going + Return (migration 393)', () => {
  it('the role and ride count span both legs', () => {
    const there = board([], [])
    const back = board([offer(1, 5, 2, 0, { mine: true, direction: 'back' })], [request(2, 11, 1, { direction: 'back' })])
    const pool = { there, back, totals: { offers: 1, seats_free: 2, requests_open: 1 } }
    expect(myRole(pool)).toBe('driver')
    expect(myRole(there)).toBeNull()
    expect(entryCount(pool)).toBe(2)
    // Driving back does not stop me from riding or asking on the way there.
    expect(canRequest(there, true)).toBe(true)
    expect(canOffer(there, true)).toBe(true)
  })
})

describe('inCarpoolScope', () => {
  it('open when unscoped, else needs a shared team (ids compared as strings)', () => {
    expect(inCarpoolScope(null, [])).toBe(true)
    expect(inCarpoolScope([], ['1'])).toBe(true)
    expect(inCarpoolScope([3, 9], ['9'])).toBe(true)
    expect(inCarpoolScope(['3'], [3])).toBe(true)
    expect(inCarpoolScope([3], ['1', '2'])).toBe(false)
  })
})

describe('one ride per way per day (migration 397)', () => {
  const SAT = '2026-10-10'
  const SUN = '2026-10-11'
  it('lists the days of a multi-day activity', () => {
    expect(activityDays(SAT, SUN)).toEqual([SAT, SUN])
    expect(activityDays(SAT, null)).toEqual([SAT])
    expect(activityDays('2026-10-31', '2026-11-01')).toEqual(['2026-10-31', '2026-11-01'])
  })
  it('a Saturday driver can still offer, join and be taken on Sunday', () => {
    const b = board(
      [offer(1, 9, 3, 0, { mine: true, departure_date: SAT }), offer(2, 5, 3, 0, { departure_date: SUN }), offer(3, 6, 3, 0, { departure_date: SAT })],
      [request(4, 7, 1, { departure_date: SUN }), request(5, 8, 1, { departure_date: SAT })],
    )
    expect(canOffer(b, true)).toBe(false) // one-day rule
    expect(canOffer(b, true, true)).toBe(true) // multi-day: the form picks the day
    expect(canJoin(b, b.offers[1], true)).toBe(true) // Sunday car, I drive Saturday only
    expect(canJoin(b, b.offers[2], true)).toBe(false) // Saturday car, I drive that day
    expect(canTake(b, b.requests[0], true)).toBe(false) // Sunday request, no Sunday car of mine
    expect(canTake(b, b.requests[1], true)).toBe(true)
    expect(myRideDays(b, 'offer')).toEqual([SAT])
    expect(myRideDays(b, 'offer', 1)).toEqual([])
    expect(firstFreeDay([SAT, SUN], myRideDays(b, 'offer'), SAT)).toBe(SUN)
    expect(firstFreeDay([SAT, SUN], [SAT, SUN], SAT)).toBe(SAT)
  })
  it('joins with the seats asked for on that day', () => {
    const b = board([], [request(4, 9, 2, { mine: true, departure_date: SAT }), request(5, 9, 1, { mine: true, departure_date: SUN })])
    expect(seatsINeed(b, SAT)).toBe(2)
    expect(seatsINeed(b, SUN)).toBe(1)
  })
})
