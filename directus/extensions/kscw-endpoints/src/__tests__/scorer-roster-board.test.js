// The LedBox board as a read-only audience of the match sheet: who counts as the board, and
// the window it gets (the coach's, wider than the scorer's — halls rarely give it an uplink).
import { describe, expect, it } from 'vitest'
import { inRosterWindow, isLedboxBoard, LEDBOX_POLICY_NAME } from '../scorer-roster.js'

const H = 60 * 60 * 1000
const KICKOFF = Date.UTC(2026, 9, 2, 18, 0)

describe('inRosterWindow', () => {
  it('gives the board the coach window (−6h … +3h)', () => {
    expect(inRosterWindow('board', KICKOFF, KICKOFF - 6 * H)).toBe(true)
    expect(inRosterWindow('board', KICKOFF, KICKOFF - 6 * H - 1)).toBe(false)
    expect(inRosterWindow('board', KICKOFF, KICKOFF + 3 * H)).toBe(true)
    expect(inRosterWindow('board', KICKOFF, KICKOFF + 3 * H + 1)).toBe(false)
  })
  it('keeps the scorer at −40 min', () => {
    expect(inRosterWindow('scorer', KICKOFF, KICKOFF - 40 * 60 * 1000)).toBe(true)
    expect(inRosterWindow('scorer', KICKOFF, KICKOFF - H)).toBe(false)
  })
  it('lets admins in always, and nobody else without a kickoff time', () => {
    expect(inRosterWindow('admin', null, 0)).toBe(true)
    expect(inRosterWindow('board', null, KICKOFF)).toBe(false)
  })
})

// directus_access ⋈ directus_policies, faked just far enough to see what is asked.
function fakeDb(rows) {
  return (table) => {
    const wh = {}
    const b = {
      join: () => b,
      where: (col, val) => { wh[col] = val; return b },
      first: async () => rows.find((r) => r.user === wh['directus_access.user'] && r.policy === wh['directus_policies.name']) && { id: 1 },
    }
    expect(table).toBe('directus_access')
    return b
  }
}

describe('isLedboxBoard', () => {
  const db = fakeDb([{ user: 'board-uuid', policy: LEDBOX_POLICY_NAME }, { user: 'tr-uuid', policy: 'KSCW Team Responsible' }])
  it('is true only for a user holding the LedBox policy', async () => {
    expect(await isLedboxBoard(db, 'board-uuid')).toBe(true)
    expect(await isLedboxBoard(db, 'tr-uuid')).toBe(false)
    expect(await isLedboxBoard(db, null)).toBe(false)
  })
})
