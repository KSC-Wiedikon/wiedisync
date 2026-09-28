import { describe, it, expect } from 'vitest'
import type { CarpoolLeg, CarpoolOffer, CarpoolRequest } from '../carpoolApi'
import { canJoin, canOffer, canRequest, canTake, entryCount, inCarpoolScope, myRole, seatsINeed } from '../carpoolFormat'

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
