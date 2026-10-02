import { describe, it, expect } from 'vitest'
import { pickOfficials as previewPick } from '../nomination-push.js'
import { pickOfficials as workerPick } from '../../../../scripts/vm-push-nomination.mjs'

// The preview (endpoint) MIRRORS the worker's official resolution — the coach must be
// shown exactly who the push will send. A drift here is a preview that lies.
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
})
