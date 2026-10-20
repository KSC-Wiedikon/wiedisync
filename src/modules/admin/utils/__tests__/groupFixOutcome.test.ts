import { describe, it, expect } from 'vitest'
import en from '../../../../i18n/locales/en/admin'
import de from '../../../../i18n/locales/de/admin'
import {
  EXPLAINED_STATUSES, HELD_BACK, NOT_ATTEMPTED, OK_STATUSES, isOkStatus, statusReasonKey,
  summarizeGroupFixResult, type GroupFixResult,
} from '../groupFixOutcome'

const row = (name: string, status: string) => ({ name, group: 'VB H2', funktion: 'Spieler*in', status })

describe('OK_STATUSES', () => {
  it('is exactly the three statuses a tool reports for a row it did', () => {
    expect([...OK_STATUSES].sort()).toEqual(['assigned', 'previewed', 'removed'])
    expect(isOkStatus('preview_ok')).toBe(false)
    expect(isOkStatus(undefined)).toBe(false)
  })
})

describe('summarizeGroupFixResult', () => {
  it('the 20.10.2026 preview: 17 rows, all skip_filter_failed → 0 ok', () => {
    const result: GroupFixResult = {
      mode: 'preview',
      add: { mode: 'preview', count: 16, results: Array.from({ length: 16 }, (_, i) => row(`A${i}`, 'skip_filter_failed')) },
      remove: { mode: 'preview', count: 1, results: [{ name: 'R', group_label: 'VB D1 (Guest)', status: 'skip_filter_failed' }] },
    }
    const o = summarizeGroupFixResult(result)
    expect(o.ok).toBe(0)
    expect(o.skipped).toBe(17)
    expect(o.notAttempted).toBe(0)
    expect(o.byStatus).toEqual([{ status: 'skip_filter_failed', count: 17 }])
    expect(o.dominant).toBe('skip_filter_failed')
    // removals first — they run first
    expect(o.rows[0].kind).toBe('remove')
  })

  it('a partial commit: ok, skipped and status groups, most frequent first', () => {
    const o = summarizeGroupFixResult({
      mode: 'commit',
      add: { count: 5, results: [row('a', 'assigned'), row('b', 'assigned'), row('c', 'skip_ok_disabled'), row('d', 'error'), row('e', 'error')] },
      remove: { count: 1, results: [{ name: 'f', status: 'removed' }] },
    })
    expect(o.ok).toBe(3)
    expect(o.skipped).toBe(3)
    expect(o.byStatus).toEqual([{ status: 'error', count: 2 }, { status: 'skip_ok_disabled', count: 1 }])
    expect(o.dominant).toBe('error')
    expect(o.fatal).toBeNull()
  })

  it('a tool that died early: rows it never reported are "not attempted", with its message', () => {
    const o = summarizeGroupFixResult({
      mode: 'preview',
      add: { count: 17, results: [], fatal: 'ClubDesk contact grid has no "Wiedisync ID" column' },
      remove: null,
    })
    expect(o.ok).toBe(0)
    expect(o.notAttempted).toBe(17)
    expect(o.byStatus).toEqual([{ status: NOT_ATTEMPTED, count: 17 }])
    expect(o.dominant).toBe(NOT_ATTEMPTED)
    expect(o.fatal).toContain('Wiedisync ID')
  })

  it('an all-good run has nothing in byStatus and no dominant cause', () => {
    const o = summarizeGroupFixResult({ add: { count: 2, results: [row('a', 'previewed'), row('b', 'previewed')] }, remove: null })
    expect(o.ok).toBe(2)
    expect(o.byStatus).toEqual([])
    expect(o.dominant).toBeNull()
  })

  it('null / empty result is an empty outcome, not a crash', () => {
    const o = summarizeGroupFixResult(null)
    expect(o).toMatchObject({ ok: 0, skipped: 0, notAttempted: 0, dominant: null, fatal: null })
    expect(o.rows).toEqual([])
  })

  it('rows held back from the commit are not written, and say so', () => {
    const o = summarizeGroupFixResult({
      mode: 'commit', held_back: 5,
      add: { count: 12, results: Array.from({ length: 12 }, (_, i) => row(`p${i}`, 'assigned')) },
      remove: null,
    })
    expect(o.ok).toBe(12)
    expect(o.heldBack).toBe(5)
    expect(o.notWritten).toBe(5)
    expect(o.byStatus).toEqual([{ status: HELD_BACK, count: 5 }])
  })

  it('notWritten = skipped + not attempted + held back', () => {
    const o = summarizeGroupFixResult({
      mode: 'commit', held_back: 2,
      add: { count: 5, results: [row('a', 'assigned'), row('b', 'error'), row('c', 'skip_ok_disabled')] },
      remove: null,
    })
    expect(o).toMatchObject({ ok: 1, skipped: 2, notAttempted: 2, heldBack: 2, notWritten: 6 })
  })

  it('a garbage held_back counts as none', () => {
    const r = { add: { results: [row('a', 'assigned')] }, remove: null, held_back: 'x' as unknown as number }
    expect(summarizeGroupFixResult(r).heldBack).toBe(0)
  })

  it('a row without a status counts as an error, never as ok', () => {
    const o = summarizeGroupFixResult({ add: { results: [{ name: 'x' }] }, remove: null })
    expect(o.ok).toBe(0)
    expect(o.byStatus).toEqual([{ status: 'error', count: 1 }])
  })
})

describe('status reasons', () => {
  it('every explained status has an EN and a DE line, in sentence case', () => {
    const enMap = en as Record<string, string>
    const deMap = de as Record<string, string>
    for (const s of EXPLAINED_STATUSES) {
      const key = statusReasonKey(s)!
      expect(enMap[key], `en ${key}`).toBeTruthy()
      expect(deMap[key], `de ${key}`).toBeTruthy()
      expect(enMap[key][0]).toBe(enMap[key][0].toUpperCase())
    }
  })

  it('an unknown status has no reason key', () => {
    expect(statusReasonKey('skip_something_new')).toBeNull()
  })
})
