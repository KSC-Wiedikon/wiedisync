import { describe, it, expect } from 'vitest'
import { officialsWhoSaidYes as previewYes, pickOfficials as previewPick, pickPlayerIds as previewPlayers } from '../nomination-push.js'
import { officialsWhoSaidYes as workerYes, pickOfficials as workerPick, pickPlayerIds as workerPlayers } from '../../../../scripts/vm-push-nomination.mjs'

// The preview (endpoint) MIRRORS the worker's official resolution — the coach must be
// shown exactly who the push will send. A drift here is a preview that lies.
describe('nomination players — preview mirrors the worker', () => {
  const cases = [
    [[], [1, 2, 3], [1, 3]],
    [[], [1, 2, 3], []],
    [[{ member: 1, dropped: false }, { member: 2, dropped: true }, { member: 9, dropped: false }], [1, 2, 3], [2, 3]],
    [[{ member: null, dropped: false }, { member: 4, dropped: false }], [1], [1]],
    [[{ member: 2, dropped: true }], [1, 2], [1, 2]],
    [[{ member: { id: 5 }, dropped: false }], [1], [1]],
  ]
  it.each(cases)('case %#', (sheet, regulars, yes) => {
    expect(previewPlayers(sheet, regulars, new Set(yes))).toEqual(workerPlayers(sheet, regulars, new Set(yes)))
  })

  it('the saved sheet decides, also over who said Yes', () => {
    const sheet = [{ member: 1, dropped: false }, { member: 2, dropped: true }, { member: 9, dropped: false }]
    expect(workerPlayers(sheet, [1, 2, 3], new Set([2, 3]))).toEqual([1, 9])
  })

  it('without one, the regular players who said Yes', () => {
    expect(workerPlayers([], [1, 2, 3], new Set([1, 3, 7]))).toEqual([1, 3])
  })

  it('a sheet that struck everyone off is still the sheet', () => {
    expect(workerPlayers([{ member: 2, dropped: true }], [1, 2], new Set([1, 2]))).toEqual([])
  })
})

describe('nomination officials — preview mirrors the worker', () => {
  const teamDefault = { coach: '5', assistant_coach_1: 7 }
  const cases = [
    [[], teamDefault],
    [[], undefined],
    [[{ member: 9, role: 'coach' }, { member: 3, role: 'physio' }], teamDefault],
    [[{ member: null, role: 'coach' }, { member: 4, role: 'assistant_coach_2' }], teamDefault],
    [[{ member: 9, role: null }], teamDefault],
  ]
  it.each(cases)('case %#', (rows, def) => {
    expect(previewPick(rows, def)).toEqual(workerPick(rows, def))
  })

  const yesSets = [[], [5], [7], [5, 7], [9], [4]]
  it.each(cases.flatMap(([rows, def]) => yesSets.map((yes) => [rows, def, yes])))('who said Yes, case %#', (rows, def, yes) => {
    expect(previewYes(previewPick(rows, def), new Set(yes))).toEqual(workerYes(workerPick(rows, def), new Set(yes)))
  })
})
