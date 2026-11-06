// The match sheet as the one place to change who plays (migration 446): when a coach gets it,
// what a save does to the RSVPs, and how a saved sheet follows the list Volleymanager holds.
import { describe, expect, it } from 'vitest'
import {
  alignSheetToList,
  birthdatesVisible,
  inRosterWindow,
  sheetMembershipChange,
  SHEET_DROP_NOTE,
  writeSheetRsvps,
} from '../scorer-roster.js'

const H = 60 * 60 * 1000
const KICKOFF = Date.UTC(2026, 10, 14, 10, 0)

describe('the window', () => {
  it('opens for a coach when the automatic list is filed', () => {
    expect(inRosterWindow('coach', KICKOFF, KICKOFF - 24 * H)).toBe(true)
    expect(inRosterWindow('coach', KICKOFF, KICKOFF - 24 * H - 1)).toBe(false)
    expect(inRosterWindow('coach', KICKOFF, KICKOFF + 3 * H)).toBe(true)
    expect(inRosterWindow('coach', KICKOFF, KICKOFF + 3 * H + 1)).toBe(false)
  })

  it('stays where it was for everyone who cannot edit', () => {
    for (const access of ['guest_coach', 'board']) {
      expect(inRosterWindow(access, KICKOFF, KICKOFF - 6 * H)).toBe(true)
      expect(inRosterWindow(access, KICKOFF, KICKOFF - 6 * H - 1)).toBe(false)
    }
    expect(inRosterWindow('scorer', KICKOFF, KICKOFF - 41 * 60 * 1000)).toBe(false)
  })

  it('hands a coach full dates of birth only from −6 h, as before', () => {
    expect(birthdatesVisible('coach', KICKOFF, KICKOFF - 6 * H)).toBe(true)
    expect(birthdatesVisible('coach', KICKOFF, KICKOFF - 6 * H - 1)).toBe(false)
    expect(birthdatesVisible('admin', KICKOFF, KICKOFF - 24 * H)).toBe(true)
    expect(birthdatesVisible('guest_coach', KICKOFF, KICKOFF - 6 * H)).toBe(true)
  })
})

describe('sheetMembershipChange', () => {
  it('names who left and who joined', () => {
    expect(sheetMembershipChange([1, 2, 3], [2, 3, 4])).toEqual({ leaving: [1], joining: [4] })
  })
  it('is empty when the same people stay', () => {
    expect(sheetMembershipChange([1, 2], [2, 1])).toEqual({ leaving: [], joining: [] })
  })
})

/** Just enough of a knex transaction to see what the RSVP write does. */
function fakeTrx({ rows = [], guests = [] }) {
  const writes = []
  const trx = (table) => {
    const q = {}
    let whereId = null
    for (const m of ['whereNull', 'whereIn']) q[m] = () => q
    q.where = (a, b) => { if (a === 'id') whereId = b; return q }
    q.select = async () => (table === 'participations' ? rows : [])
    q.pluck = async () => (table === 'member_teams' ? guests : [])
    q.insert = async (data) => { writes.push({ op: 'insert', ...data }) }
    q.update = async (data) => { writes.push({ op: 'update', id: whereId, ...data }) }
    return q
  }
  return { trx, writes }
}

describe('writeSheetRsvps', () => {
  const USER = 'user-uuid'
  const write = (fake, leaving, joining) =>
    writeSheetRsvps(fake.trx, { gameId: 421, teamId: 92, leaving, joining, userId: USER })

  it('a Yes taken off the sheet becomes a No, with a note and who did it', async () => {
    const fake = fakeTrx({ rows: [{ id: 7, member: 1, status: 'confirmed', note: null }] })
    expect(await write(fake, [1], [])).toEqual({ declined: 1, confirmed: 0 })
    expect(fake.writes[0]).toMatchObject({
      op: 'update', id: 7, status: 'declined', note: SHEET_DROP_NOTE, last_status_edited_by: USER, last_note_edited_by: USER,
    })
  })

  it('keeps a note the player wrote', async () => {
    const fake = fakeTrx({ rows: [{ id: 7, member: 1, status: 'confirmed', note: 'arrive late' }] })
    await write(fake, [1], [])
    expect(fake.writes[0].status).toBe('declined')
    expect(fake.writes[0]).not.toHaveProperty('note')
  })

  it('someone who never answered gets a row', async () => {
    const fake = fakeTrx({})
    await write(fake, [1], [2])
    expect(fake.writes).toHaveLength(2)
    expect(fake.writes[0]).toMatchObject({ op: 'insert', activity_type: 'game', activity_id: '421', member: 1, status: 'declined', note: SHEET_DROP_NOTE })
    expect(fake.writes[1]).toMatchObject({ op: 'insert', member: 2, status: 'confirmed' })
    expect(fake.writes[1]).not.toHaveProperty('note')
  })

  it('put back on the sheet, the Yes returns and our note goes', async () => {
    const fake = fakeTrx({ rows: [{ id: 7, member: 1, status: 'declined', note: SHEET_DROP_NOTE }] })
    expect(await write(fake, [], [1])).toEqual({ declined: 0, confirmed: 1 })
    expect(fake.writes[0]).toMatchObject({ status: 'confirmed', note: null })
  })

  it('writes nothing for an answer that already fits', async () => {
    const fake = fakeTrx({ rows: [{ id: 7, member: 1, status: 'declined', note: null }, { id: 8, member: 2, status: 'confirmed', note: null }] })
    expect(await write(fake, [1], [2])).toEqual({ declined: 0, confirmed: 0 })
    expect(fake.writes).toEqual([])
  })

  it('a guest on the roster is not made a Yes: the database refuses that', async () => {
    const fake = fakeTrx({ guests: [5] })
    expect(await write(fake, [], [5])).toEqual({ declined: 0, confirmed: 0 })
    expect(fake.writes).toEqual([])
  })

  it('a guest can still come off', async () => {
    const fake = fakeTrx({ rows: [{ id: 9, member: 5, status: 'confirmed', note: null }], guests: [5] })
    expect(await write(fake, [5], [])).toEqual({ declined: 1, confirmed: 0 })
  })

  it('does nothing when nobody moved', async () => {
    const fake = fakeTrx({})
    expect(await write(fake, [], [])).toEqual({ declined: 0, confirmed: 0 })
  })
})

describe('alignSheetToList', () => {
  const row = (member, extra = {}) => ({
    member, number: member, last_name: `L${member}`, first_initial: 'A.', is_captain: false, is_libero: false, added: false, dropped: false, ...extra,
  })

  it('null when the sheet already is the list', () => {
    expect(alignSheetToList([row(1), row(2)], [row(1), row(2)])).toBeNull()
  })

  it('a change made in Volleymanager arrives: who is on it follows, numbers and flags stay', () => {
    const saved = [row(1, { number: 7, is_captain: true }), row(2, { number: 8, is_libero: true }), row(3)]
    const out = alignSheetToList(saved, [row(1, { number: 99 }), row(2), row(4)])
    expect(out.map((r) => r.member)).toEqual([1, 2, 4])
    expect(out[0]).toMatchObject({ number: 7, is_captain: true })
    expect(out[1]).toMatchObject({ number: 8, is_libero: true })
    expect(out[2]).toMatchObject({ number: 4, added: false, dropped: false })
  })

  it('once Volleymanager holds the coach\'s change, the marks on the sheet go', () => {
    const saved = [row(1), row(2, { dropped: true }), row(3, { added: true })]
    const out = alignSheetToList(saved, [row(1), row(3)])
    expect(out.map((r) => r.member)).toEqual([1, 3])
    expect(out.every((r) => !r.added && !r.dropped)).toBe(true)
  })

  it('someone struck off who is on the list again keeps their number', () => {
    const out = alignSheetToList([row(1, { number: 5, dropped: true })], [row(1, { number: 99 })])
    expect(out[0]).toMatchObject({ member: 1, number: 5, dropped: false })
  })

  it('never ends with two captains', () => {
    const out = alignSheetToList([row(1, { is_captain: true })], [row(1), row(2, { is_captain: true })])
    expect(out.filter((r) => r.is_captain).map((r) => r.member)).toEqual([1])
  })

  it('the team captain counts when the saved captain left the list', () => {
    const out = alignSheetToList([row(1, { is_captain: true })], [row(2, { is_captain: true })])
    expect(out[0]).toMatchObject({ member: 2, is_captain: true })
  })

  it('tells people we hold no member for apart by name', () => {
    const unlinked = { member: null, last_name: 'Muster', first_initial: 'M.', number: null, is_captain: false, is_libero: false, added: false, dropped: false }
    expect(alignSheetToList([unlinked], [{ ...unlinked }])).toBeNull()
    expect(alignSheetToList([unlinked], [{ ...unlinked, last_name: 'Other' }])[0].last_name).toBe('Other')
  })
})
