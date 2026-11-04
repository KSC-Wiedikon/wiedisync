// The Einsatzliste is read from Volleymanager ONCE (kickoff −45 min, or a coach's Recheck)
// and stored in game_vm_sheets (migration 396) — every sheet surface reads the stored row.
// These pin the store (a failed read never wipes the last good list) and the flags the
// sheet shows. Volleymanager itself is mocked: nothing here logs in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../vm-nomination-list.js', () => ({ readOwnNominationList: vi.fn() }))

import { readOwnNominationList } from '../vm-nomination-list.js'
import { runVmCheck, VM_CHECK_LEAD_MS } from '../vm-sheet-check.js'
import { compareEinsatzliste, vmCheckSummary } from '../scorer-roster.js'

const noop = () => {}
const log = { info: noop, warn: noop, error: noop }

// Kickoff Fri 02.10.2026 20:00 Zurich = 18:00Z.
const KICKOFF = Date.UTC(2026, 9, 2, 18, 0)
const GAME = { id: 509, game_id: 'vb_406300', type: 'home', date: '2026-10-02', time: '20:00:00' }
const LIST = {
  players: [
    { license_nr: '111', last_name: 'Muster', first_initial: 'A.', birthdate: '2000-01-01', licence: 'A', eligible: true },
  ],
  coaches: [{ license_nr: '222', last_name: 'Coach', first_initial: 'C.', birthdate: null, role: 'coach' }],
  closed_at: '2026-10-02T17:10:00Z',
}

function fakeDb({ uuid = 'uuid-509' } = {}) {
  const writes = []
  const db = (table) => {
    const b = {}
    b.where = () => b
    b.first = async () => (table === 'svrz_games' && uuid ? { svrz_persistence_id: uuid } : undefined)
    b.insert = (row) => ({
      onConflict: (col) => ({ merge: async (cols) => { writes.push({ table, row, col, cols }) } }),
    })
    return b
  }
  return { db, writes }
}

describe('runVmCheck — one read, stored', () => {
  beforeEach(() => vi.mocked(readOwnNominationList).mockReset())

  it('stores a list VM answered with, stamped with when it was read', async () => {
    vi.mocked(readOwnNominationList).mockResolvedValue({ status: 'ok', list: LIST })
    const { db, writes } = fakeDb()
    const r = await runVmCheck(db, log, GAME)
    expect(r).toMatchObject({ status: 'ok', stored: true })
    expect(readOwnNominationList).toHaveBeenCalledWith('uuid-509', log, { side: 'home' })
    expect(writes).toHaveLength(1)
    const { table, row, col, cols } = writes[0]
    expect(table).toBe('game_vm_sheets')
    expect(col).toBe('game')
    expect(row).toMatchObject({ game: 509, status: 'ok', checked_by: null, checked_by_name: null })
    expect(JSON.parse(row.list)).toEqual(LIST)
    expect(row.list_at).toBeInstanceOf(Date)
    expect(cols).toEqual(expect.arrayContaining(['list', 'list_at', 'status', 'checked_at']))
  })

  it('a failed read records the attempt but never wipes the last good list', async () => {
    vi.mocked(readOwnNominationList).mockResolvedValue({ status: 'failed', error: 'HTTP 500' })
    const { db, writes } = fakeDb()
    await runVmCheck(db, log, GAME)
    expect(writes[0].row).toMatchObject({ status: 'failed', error: 'HTTP 500' })
    expect(writes[0].cols).not.toContain('list')
    expect(writes[0].cols).not.toContain('list_at')
  })

  it('"none filed" is an answer: it replaces the list with nothing', async () => {
    vi.mocked(readOwnNominationList).mockResolvedValue({ status: 'no_list' })
    const { db, writes } = fakeDb()
    await runVmCheck(db, log, GAME)
    expect(writes[0].row).toMatchObject({ status: 'no_list', list: null })
    expect(writes[0].cols).toEqual(expect.arrayContaining(['list', 'list_at']))
  })

  it('busy read nothing: the cron stores it (next tick retries), a Recheck stores nothing', async () => {
    vi.mocked(readOwnNominationList).mockResolvedValue({ status: 'busy', error: 'account busy (vm_sync)' })
    const cron = fakeDb()
    expect(await runVmCheck(cron.db, log, GAME)).toMatchObject({ stored: true })
    expect(cron.writes[0].row.status).toBe('busy')

    const recheck = fakeDb()
    expect(await runVmCheck(recheck.db, log, GAME, { by: { id: 8, name: 'Luca Canepa' } })).toMatchObject({ stored: false })
    expect(recheck.writes).toHaveLength(0)
  })

  it('records who pressed Recheck', async () => {
    vi.mocked(readOwnNominationList).mockResolvedValue({ status: 'ok', list: LIST })
    const { db, writes } = fakeDb()
    await runVmCheck(db, log, GAME, { by: { id: 8, name: 'Luca Canepa' } })
    expect(writes[0].row).toMatchObject({ checked_by: 8, checked_by_name: 'Luca Canepa' })
  })

  it('reads the away side for an away leg, and never calls VM for a game it has no fixture for', async () => {
    vi.mocked(readOwnNominationList).mockResolvedValue({ status: 'ok', list: LIST })
    await runVmCheck(fakeDb().db, log, { ...GAME, type: 'away' })
    expect(readOwnNominationList).toHaveBeenLastCalledWith('uuid-509', log, { side: 'away' })

    vi.mocked(readOwnNominationList).mockClear()
    const basketball = fakeDb()
    await runVmCheck(basketball.db, log, { ...GAME, game_id: 'bb_123' })
    const noFixture = fakeDb({ uuid: null })
    await runVmCheck(noFixture.db, log, GAME)
    expect(readOwnNominationList).not.toHaveBeenCalled()
    expect(basketball.writes[0].row.status).toBe('unavailable')
    expect(noFixture.writes[0].row.status).toBe('unavailable')
  })
})

describe('vmCheckSummary — what the sheet flags', () => {
  afterEach(() => vi.useRealTimers())
  const at = (ms) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(ms) }
  const vmSheet = { source: 'vm', roster: [{ member: 12, last_name: 'Muster', first_initial: 'A.' }] }
  const codes = (s) => s.issues.map((i) => i.code)

  it('basketball has no Volleymanager', () => {
    expect(vmCheckSummary(null, { ...GAME, game_id: 'bb_1' }, vmSheet)).toBeNull()
  })

  it('before −45 min: nothing to flag, and says when it will be read', () => {
    at(KICKOFF - 2 * 3600 * 1000)
    const s = vmCheckSummary(null, GAME, vmSheet)
    expect(s.issues).toEqual([])
    expect(s.due_at).toBe(new Date(KICKOFF - VM_CHECK_LEAD_MS).toISOString())
  })

  it('past −45 min with no read: flagged', () => {
    at(KICKOFF - 30 * 60 * 1000)
    expect(codes(vmCheckSummary(null, GAME, vmSheet))).toEqual(['not_checked'])
  })

  it('a clean list: no flags', () => {
    const check = { status: 'ok', list: LIST, list_at: '2026-10-02T17:15:00Z', checked_at: '2026-10-02T17:15:00Z' }
    expect(vmCheckSummary(check, GAME, vmSheet).issues).toEqual([])
  })

  it('a list that is not closed is not flagged: referees close it', () => {
    const check = { status: 'ok', list: { ...LIST, closed_at: null }, list_at: '2026-10-02T17:15:00Z' }
    expect(vmCheckSummary(check, GAME, vmSheet).issues).toEqual([])
  })

  it('a failed recheck keeps the old list and is flagged', () => {
    const check = { status: 'failed', error: 'HTTP 500', list: LIST, list_at: '2026-10-02T17:15:00Z' }
    expect(codes(vmCheckSummary(check, GAME, vmSheet))).toEqual(['failed'])
  })

  it('carries the verdict, and no separate flag for an empty or missing list', () => {
    const noList = { verdict: 'no_list', nominated_without_yes: [], yes_not_nominated: [] }
    for (const check of [
      { status: 'no_list', list: null, list_at: '2026-10-02T17:15:00Z' },
      { status: 'ok', list: { ...LIST, players: [] }, list_at: '2026-10-02T17:15:00Z' },
    ]) {
      const s = vmCheckSummary(check, GAME, vmSheet, noList)
      expect(s.verdict).toBe('no_list')
      expect(s.issues).toEqual([])
    }
  })

  it('no verdict before a read', () => {
    at(KICKOFF - 3 * 3600 * 1000)
    expect(vmCheckSummary(null, GAME, vmSheet).verdict).toBeNull()
  })

  it('names ineligible and unlinked players', () => {
    const list = { ...LIST, players: [{ ...LIST.players[0], eligible: false }] }
    const sheet = { source: 'vm', roster: [{ member: null, last_name: 'Fremd', first_initial: 'F.' }] }
    const s = vmCheckSummary({ status: 'ok', list, list_at: '2026-10-02T17:15:00Z' }, GAME, sheet)
    expect(s.issues).toEqual([
      { code: 'ineligible', names: ['Muster A.'] },
      { code: 'unlinked', names: ['Fremd F.'] },
    ])
  })
})

describe('compareEinsatzliste — the list against the RSVPs', () => {
  const player = (nr, last) => ({ license_nr: nr, last_name: last, first_initial: 'A.' })
  const licences = new Map([['111', 12], ['222', 13]])
  const regulars = [
    { id: 12, first_name: 'Anna', last_name: 'Muster' },
    { id: 13, first_name: 'Bea', last_name: 'Beispiel' },
    { id: 14, first_name: 'Cleo', last_name: 'Test' },
  ]

  it('nothing filed, or filed without players: no list', () => {
    for (const players of [null, undefined, []]) {
      expect(compareEinsatzliste(players, licences, new Map([[14, 'confirmed']]), regulars)).toEqual({
        verdict: 'no_list', nominated_without_yes: [], yes_not_nominated: [],
      })
    }
  })

  it('everyone on the list said Yes, nobody else did: matches', () => {
    const rsvps = new Map([[12, 'confirmed'], [13, 'confirmed']])
    expect(compareEinsatzliste([player('111', 'Muster'), player('222', 'Beispiel')], licences, rsvps, regulars).verdict).toBe('matches')
  })

  it.each(['declined', 'tentative', 'waitlisted'])('on the list with %s: differs', (status) => {
    const c = compareEinsatzliste([player('111', 'Muster')], licences, new Map([[12, status]]), regulars)
    expect(c.verdict).toBe('differs')
    expect(c.nominated_without_yes).toEqual([{ name: 'Muster A.', rsvp: status }])
  })

  it('on the list with no answer: differs', () => {
    const c = compareEinsatzliste([player('111', 'Muster')], licences, new Map(), regulars)
    expect(c.nominated_without_yes).toEqual([{ name: 'Muster A.', rsvp: 'none' }])
  })

  it('said Yes, not on the list: differs', () => {
    const rsvps = new Map([[12, 'confirmed'], [14, 'confirmed']])
    const c = compareEinsatzliste([player('111', 'Muster')], licences, rsvps, regulars)
    expect(c.verdict).toBe('differs')
    expect(c.yes_not_nominated).toEqual([{ name: 'Test C.' }])
  })

  it('a guest who said Yes need not be on the list', () => {
    const rsvps = new Map([[12, 'confirmed'], [99, 'confirmed']])
    expect(compareEinsatzliste([player('111', 'Muster')], licences, rsvps, regulars).verdict).toBe('matches')
  })

  it.each([undefined, 'declined', 'tentative'])('a guest on the list needs no Yes (%s)', (status) => {
    const withGuest = new Map([...licences, ['333', 99]])
    const rsvps = new Map([[12, 'confirmed'], ...(status ? [[99, status]] : [])])
    expect(compareEinsatzliste([player('111', 'Muster'), player('333', 'Gast')], withGuest, rsvps, regulars).verdict).toBe('matches')
  })

  it('a list of guests only still leaves a regular Yes off it', () => {
    const withGuest = new Map([...licences, ['333', 99]])
    const c = compareEinsatzliste([player('333', 'Gast')], withGuest, new Map([[12, 'confirmed']]), regulars)
    expect(c.verdict).toBe('differs')
    expect(c.nominated_without_yes).toEqual([])
    expect(c.yes_not_nominated).toEqual([{ name: 'Muster A.' }])
  })

  it('a licence we hold no member for is left out', () => {
    const rsvps = new Map([[12, 'confirmed']])
    expect(compareEinsatzliste([player('111', 'Muster'), player('999', 'Fremd')], licences, rsvps, regulars).verdict).toBe('matches')
  })
})
