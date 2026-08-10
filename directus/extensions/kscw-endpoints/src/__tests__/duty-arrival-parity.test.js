// The duty arrival time drives three user-visible things: what /scorer shows a
// member, what the reminder email tells them, and when the coach's "report
// late" button arms — the last of which auto-issues a CHF 50 no-show fine. It
// lived in three hand-written copies and had already drifted (audit
// 2026-08-08, finding 38): scorer-reminders.js said 10 minutes for the Täfeler
// where the other two said 15.
//
// scorer-reminders.js now imports ROLE_DEFS, so those two cannot diverge. The
// frontend's DUTY_ARRIVAL_MIN is a separate module in a separate build, so it
// is pinned here by parsing the source — the same device season-parity uses.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ROLE_DEFS } from '../duty-late.js'

/** Parse DUTY_ARRIVAL_MIN out of the frontend helper without importing TS. */
function frontendArrivalTable() {
  const src = readFileSync(new URL('../../../../../src/utils/dateHelpers.ts', import.meta.url), 'utf8')
  const block = src.match(/export const DUTY_ARRIVAL_MIN[^=]*=\s*\{([\s\S]*?)\}/)
  if (!block) throw new Error('DUTY_ARRIVAL_MIN not found — did dateHelpers.ts move?')
  const table = {}
  for (const [, role, mins] of block[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) table[role] = Number(mins)
  return table
}

describe('duty arrival parity', () => {
  const frontend = frontendArrivalTable()

  it('finds a non-trivial frontend table (guards against a vacuous pass)', () => {
    expect(Object.keys(frontend).length).toBeGreaterThanOrEqual(7)
    expect(frontend.scoreboard).toBeDefined()
  })

  it('every backend role agrees with the frontend', () => {
    for (const [role, def] of Object.entries(ROLE_DEFS)) {
      expect(frontend[role], `DUTY_ARRIVAL_MIN is missing "${role}"`).toBeDefined()
      expect(def.arrival, `arrival mismatch for "${role}"`).toBe(frontend[role])
    }
  })

  it('covers exactly the same roles in both directions', () => {
    expect(Object.keys(ROLE_DEFS).sort()).toEqual(Object.keys(frontend).sort())
  })

  it('pins the Täfeler at 15 — the value that drives the fine window', () => {
    // If the club rule really is 10, change it HERE and in dateHelpers together,
    // and understand that you are moving when the CHF 50 fine becomes issuable.
    expect(ROLE_DEFS.scoreboard.arrival).toBe(15)
    expect(frontend.scoreboard).toBe(15)
  })
})
