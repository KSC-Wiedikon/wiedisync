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
const GAME = { id: 424, date: '2026-11-14', time: '11:00:00', vm_nomination_status: null, vm_nomination_claimed_at: null }
const DAY_BEFORE = KICKOFF - NOMINATION_LEAD_MS
const SECOND_CHANCE = KICKOFF - NOMINATION_SECOND_CHANCE_MS
const iso = (ms) => new Date(ms).toISOString()

describe('nominationPushDue', () => {
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
      expect(nominationPushDue({ ...GAME, vm_nomination_status }, DAY_BEFORE + 5 * MIN)).toBe(false)
      expect(nominationPushDue({ ...GAME, vm_nomination_status }, SECOND_CHANCE)).toBe(false)
    }
  })

  it('filled and skipped wait for the second chance, then every tick', () => {
    for (const vm_nomination_status of ['filled', 'skipped']) {
      const game = { ...GAME, vm_nomination_status, vm_nomination_claimed_at: iso(DAY_BEFORE) }
      expect(nominationPushDue(game, DAY_BEFORE + 5 * MIN)).toBe(false)
      expect(nominationPushDue(game, SECOND_CHANCE - 1)).toBe(false)
      expect(nominationPushDue(game, SECOND_CHANCE)).toBe(true)
      expect(nominationPushDue({ ...game, vm_nomination_claimed_at: iso(SECOND_CHANCE) }, SECOND_CHANCE + 5 * MIN)).toBe(true)
    }
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
