// When the cron files a game's Einsatzliste: the day before, with a second chance at the old time.
import { describe, expect, it } from 'vitest'

import {
  NOMINATION_FLOOR_MS,
  NOMINATION_LEAD_MS,
  NOMINATION_RETRY_MS,
  NOMINATION_SECOND_CHANCE_MS,
  nominationPushDue,
} from '../nomination-schedule.js'

// Sat 14.11.2026 11:00 Zurich (CET = UTC+1) = 10:00Z.
const KICKOFF = Date.UTC(2026, 10, 14, 10, 0)
const MIN = 60 * 1000
// The coach saved the match sheet two days before: only such a game is ever sent.
const SAVED_AT = KICKOFF - 2 * 24 * 60 * MIN
const GAME = { id: 424, date: '2026-11-14', time: '11:00:00', vm_nomination_status: null, vm_nomination_claimed_at: null, vm_nomination_sheet_changed_at: new Date(SAVED_AT).toISOString() }
const DAY_BEFORE = KICKOFF - NOMINATION_LEAD_MS
const SECOND_CHANCE = KICKOFF - NOMINATION_SECOND_CHANCE_MS
const iso = (ms) => new Date(ms).toISOString()

describe('nominationPushDue', () => {
  it('no automatic list: a game nobody saved a sheet for is never sent (owner, 13.11.2026)', () => {
    const plain = { ...GAME, vm_nomination_sheet_changed_at: null }
    for (const vm_nomination_status of [null, 'pending', 'failed', 'skipped']) {
      expect(nominationPushDue({ ...plain, vm_nomination_status }, DAY_BEFORE)).toBe(false)
      expect(nominationPushDue({ ...plain, vm_nomination_status }, SECOND_CHANCE)).toBe(false)
    }
  })

  it('first attempt 24 h before kickoff, not earlier', () => {
    expect(nominationPushDue(GAME, DAY_BEFORE - 1)).toBe(false)
    expect(nominationPushDue(GAME, DAY_BEFORE)).toBe(true)
  })

  it('a game that comes within 24 h later is picked up at once', () => {
    expect(nominationPushDue(GAME, KICKOFF - 3 * 60 * MIN)).toBe(true)
  })

  it('nothing below the floor', () => {
    expect(nominationPushDue(GAME, KICKOFF - NOMINATION_FLOOR_MS)).toBe(true)
    expect(nominationPushDue(GAME, KICKOFF - NOMINATION_FLOOR_MS + 1)).toBe(false)
  })

  it('a saved or closed list is final, also at the second chance', () => {
    for (const vm_nomination_status of ['saved', 'closed']) {
      const game = { ...GAME, vm_nomination_status, vm_nomination_claimed_at: iso(DAY_BEFORE) }
      expect(nominationPushDue(game, DAY_BEFORE + 5 * MIN)).toBe(false)
      expect(nominationPushDue(game, SECOND_CHANCE)).toBe(false)
    }
  })

  it('a flagged list is final too: a re-save would undo a fix made by hand', () => {
    const filled = { ...GAME, vm_nomination_status: 'filled', vm_nomination_claimed_at: iso(DAY_BEFORE) }
    expect(nominationPushDue(filled, DAY_BEFORE + 5 * MIN)).toBe(false)
    expect(nominationPushDue(filled, SECOND_CHANCE)).toBe(false)
  })

  it('skipped waits for the second chance, then every tick', () => {
    const skipped = { ...GAME, vm_nomination_status: 'skipped', vm_nomination_claimed_at: iso(DAY_BEFORE) }
    expect(nominationPushDue(skipped, DAY_BEFORE + 5 * MIN)).toBe(false)
    expect(nominationPushDue(skipped, SECOND_CHANCE - 1)).toBe(false)
    expect(nominationPushDue(skipped, SECOND_CHANCE)).toBe(true)
    expect(nominationPushDue({ ...skipped, vm_nomination_claimed_at: iso(SECOND_CHANCE) }, SECOND_CHANCE + 5 * MIN)).toBe(true)
  })

  it('a change on the sheet no push has seen is sent, whatever the list says', () => {
    const at = DAY_BEFORE + 60 * MIN
    for (const vm_nomination_status of ['saved', 'filled', 'skipped', 'failed']) {
      const game = {
        ...GAME,
        vm_nomination_status,
        vm_nomination_claimed_at: iso(at - MIN),
        vm_nomination_sheet_changed_at: iso(at),
      }
      expect(nominationPushDue(game, at + 5 * MIN)).toBe(true)
    }
    expect(nominationPushDue({ ...GAME, vm_nomination_sheet_changed_at: iso(at) }, at + 5 * MIN)).toBe(true)
  })

  it('a change on the sheet a push has seen is not sent again', () => {
    const at = DAY_BEFORE + 60 * MIN
    const seen = { ...GAME, vm_nomination_status: 'saved', vm_nomination_sheet_changed_at: iso(at), vm_nomination_claimed_at: iso(at + 1) }
    expect(nominationPushDue(seen, at + 5 * MIN)).toBe(false)
  })

  it('a list the referee closed stays closed, also with a change on the sheet', () => {
    const closed = { ...GAME, vm_nomination_status: 'closed', vm_nomination_sheet_changed_at: iso(DAY_BEFORE) }
    expect(nominationPushDue(closed, DAY_BEFORE + 5 * MIN)).toBe(false)
  })

  it('failed is tried again hourly, not every tick', () => {
    const failed = { ...GAME, vm_nomination_status: 'failed', vm_nomination_claimed_at: iso(DAY_BEFORE) }
    expect(nominationPushDue(failed, DAY_BEFORE + 5 * MIN)).toBe(false)
    expect(nominationPushDue(failed, DAY_BEFORE + NOMINATION_RETRY_MS - 1)).toBe(false)
    expect(nominationPushDue(failed, DAY_BEFORE + NOMINATION_RETRY_MS)).toBe(true)
  })

  it('failed with no claim on record (a reclaimed lease) is tried at once', () => {
    expect(nominationPushDue({ ...GAME, vm_nomination_status: 'failed' }, DAY_BEFORE + 5 * MIN)).toBe(true)
  })

  it('failed: every tick at the second chance', () => {
    const failed = { ...GAME, vm_nomination_status: 'failed', vm_nomination_claimed_at: iso(SECOND_CHANCE) }
    expect(nominationPushDue(failed, SECOND_CHANCE + 5 * MIN)).toBe(true)
  })

  it('pending stays a candidate: the claim decides', () => {
    expect(nominationPushDue({ ...GAME, vm_nomination_status: 'pending', vm_nomination_claimed_at: iso(DAY_BEFORE) }, DAY_BEFORE + 5 * MIN)).toBe(true)
  })

  it('no kickoff, no push', () => {
    expect(nominationPushDue({ ...GAME, time: null }, DAY_BEFORE)).toBe(false)
  })
})
