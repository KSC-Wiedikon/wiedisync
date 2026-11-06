// The match sheet as the one place to change who plays (migration 446): when a coach gets it,
// what a save does to the RSVPs, and how a saved sheet follows the list Volleymanager holds.
import { describe, expect, it } from 'vitest'
import {
  alignSheetToList,
  birthdatesVisible,
  followVmList,
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

describe('followVmList', () => {
  const FUTURE = new Date(Date.now() + 5 * H)
  const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(d)
  const hm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' }).format(d)
  const GAME_ROW = { date: ymd(FUTURE), time: hm(FUTURE), kscw_team: 92, vm_nomination_status: 'saved', vm_nomination_claimed_at: null, vm_nomination_sheet_changed_at: null }
  const sheetRow = (member, extra = {}) => ({
    member, last_name: `L${member}`, first_initial: 'A.', number: member, is_captain: false, is_libero: false, added: false, dropped: false,
    licence: null, eligible: true, birthdate: null, source: 'vm', edited_by_name: 'Coach', edited_by_email: 'c@x', date_created: new Date(0), date_updated: new Date(0), ...extra,
  })
  const LIST = {
    players: [1, 4].map((m) => ({ license_nr: String(1000 + m), last_name: `L${m}`, first_initial: 'A.', birthdate: null, licence: 'A', eligible: true })),
    coaches: [],
    closed_at: null,
  }
  const LOG = { info: () => {}, error: () => {} }

  /** The tables followVmList touches, and a record of what it writes to the sheet. */
  function fakeDb({ game = GAME_ROW, rows = [sheetRow(1), sheetRow(2)], list = LIST } = {}) {
    const writes = { deleted: 0, inserted: null, updated: null }
    const db = (table) => {
      const q = {}
      q.where = () => q
      q.whereIn = () => q
      q.first = async () => {
        if (table === 'games') return game
        if (table === 'teams') return { captain: null }
        if (table === 'game_vm_sheets') return { list }
        return null
      }
      q.select = async () => {
        if (table === 'game_rosters') return rows
        if (table === 'members') return [1, 4].map((m) => ({ id: m, number: m, position: null, license_nr: String(1000 + m) }))
        return []
      }
      q.del = async () => { writes.deleted += 1 }
      q.insert = async (data) => { writes.inserted = data }
      q.update = async (data) => { writes.updated = data }
      return q
    }
    db.transaction = (fn) => fn(db)
    return { db, writes }
  }

  it('a list changed in Volleymanager arrives on the saved sheet', async () => {
    const { db, writes } = fakeDb()
    expect(await followVmList(db, LOG, { id: 424 })).toBe(true)
    expect(writes.inserted.map((r) => r.member)).toEqual([1, 4])
    expect(writes.inserted[0]).toMatchObject({ source: 'vm', edited_by_name: 'Coach', added: false, dropped: false })
  })

  it.each(['pending', 'failed', 'skipped'])('a coach\'s change stays while the push is %s', async (vm_nomination_status) => {
    const { db, writes } = fakeDb({ game: { ...GAME_ROW, vm_nomination_status } })
    expect(await followVmList(db, LOG, { id: 424 })).toBe(false)
    expect(writes.deleted).toBe(0)
  })

  it('a coach\'s change no push has seen stays', async () => {
    const at = new Date(Date.now() - H)
    const { db, writes } = fakeDb({ game: { ...GAME_ROW, vm_nomination_claimed_at: new Date(at.getTime() - 60000), vm_nomination_sheet_changed_at: at } })
    expect(await followVmList(db, LOG, { id: 424 })).toBe(false)
    expect(writes.deleted).toBe(0)
  })

  it('from kickoff the sheet stays: a change there no longer reaches Volleymanager', async () => {
    const past = new Date(Date.now() - H)
    const { db, writes } = fakeDb({ game: { ...GAME_ROW, date: ymd(past), time: hm(past) } })
    expect(await followVmList(db, LOG, { id: 424 })).toBe(false)
    expect(writes.deleted).toBe(0)
  })

  it('nothing to follow without a saved sheet, or with an empty list', async () => {
    const none = fakeDb({ rows: [] })
    expect(await followVmList(none.db, LOG, { id: 424 })).toBe(false)
    const empty = fakeDb({ list: { players: [], coaches: [], closed_at: null } })
    expect(await followVmList(empty.db, LOG, { id: 424 })).toBe(false)
    expect(empty.writes.deleted).toBe(0)
  })

  it('a sheet saved from the RSVPs that matches only changes its label', async () => {
    const { db, writes } = fakeDb({ rows: [sheetRow(1, { source: 'rsvp' }), sheetRow(4, { source: 'rsvp' })] })
    expect(await followVmList(db, LOG, { id: 424 })).toBe(false)
    expect(writes.deleted).toBe(0)
    expect(writes.updated).toEqual({ source: 'vm' })
  })
})
