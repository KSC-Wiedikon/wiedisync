// What is defended here is one hazard: every numeric field of `vis_transfers`
// arrives as a STRING. `fetchItems` pipes results through `stringifyIds`
// (src/lib/api.ts) and none of these columns is in `KEEP_AS_NUMBER`, so
// `percent_complete === 100` is false for a finished transfer and `'60' > '100'`
// is TRUE — which picks the LEAST advanced row and shows the wrong answer to the
// only question this page asks. Both were live bugs. Every case below therefore
// feeds STRINGS where production feeds strings.

import { describe, it, expect } from 'vitest'
import {
  visTransferState,
  latestVisSeason,
  indexVisTransfersByPlayer,
  pickVisTransfer,
  visPhaseI18nKey,
  normaliseVisPlayerNo,
} from '../visTransfer'
import type { VisTransfer } from '../../types'

const transfer = (over: Partial<VisTransfer> = {}): VisTransfer => ({
  vis_no: '1',
  season_no: '17',
  ...over,
})

describe('visTransferState — status code and percentage, never status_label', () => {
  it('reads a string 100% as complete', () => {
    expect(visTransferState(transfer({ percent_complete: '100', status_code: '130' }))).toBe('complete')
  })

  it('reads an ended code as complete even below 100%', () => {
    expect(visTransferState(transfer({ status_code: '200', percent_complete: '80' }))).toBe('complete')
  })

  // "Complete" is 100% OR ended, not "ended" alone: an ITC finishes its tasks
  // weeks before VIS moves the row to 200, which only happens once the season
  // starts. Every one of the club's hand-cleared 2026/27 transfers sat at
  // 130/100% and none had reached 200.
  it('does not wait for code 200 before calling a 100% transfer complete', () => {
    expect(visTransferState(transfer({ status_code: '130', percent_complete: '100' }))).toBe('complete')
    expect(visTransferState(transfer({ status_code: '130', percent_complete: '20' }))).toBe('in_progress')
  })

  it('treats refused and cancelled codes as dead', () => {
    expect(visTransferState(transfer({ status_code: 255 }))).toBe('dead')
    expect(visTransferState(transfer({ status_code: '239' }))).toBe('dead')
    expect(visTransferState(transfer({ status_code: '240' }))).toBe('dead')
  })

  it('does not let a 100% percentage revive a dead row', () => {
    expect(visTransferState(transfer({ status_code: '255', percent_complete: '100' }))).toBe('dead')
  })
})

describe('latestVisSeason — the season the club is working now', () => {
  it('takes the highest staged season, reading strings as numbers', () => {
    expect(latestVisSeason([transfer({ season_no: '9' }), transfer({ season_no: '17' })])).toBe(17)
  })

  it('answers null for nothing staged', () => {
    expect(latestVisSeason([])).toBeNull()
    expect(latestVisSeason(undefined)).toBeNull()
  })
})

describe('indexVisTransfersByPlayer — this season only, by player number', () => {
  it('drops other seasons and soft-deleted rows, and keys by number not string', () => {
    const map = indexVisTransfersByPlayer([
      transfer({ player_no: '4471', season_no: '17' }),
      transfer({ player_no: '4471', season_no: '16' }),          // last season
      transfer({ player_no: '4471', season_no: '17', deleted_at: '2026-08-01' }),
      transfer({ player_no: null, season_no: '17' }),            // never matchable
    ], 17)
    expect(map.get(4471)).toHaveLength(1)
    expect(map.size).toBe(1)
  })
})

describe('pickVisTransfer — the most advanced live row', () => {
  it('picks 100 over 60 numerically ("60" > "100" is true as strings)', () => {
    const low = transfer({ vis_no: 'low', percent_complete: '60', status_code: '130' })
    const high = transfer({ vis_no: 'high', percent_complete: '100', status_code: '130' })
    expect(pickVisTransfer([low, high])?.vis_no).toBe('high')
    expect(pickVisTransfer([high, low])?.vis_no).toBe('high')
  })

  it('prefers a complete row over a more recent in-progress one', () => {
    const done = transfer({ vis_no: 'done', status_code: '200', percent_complete: '80' })
    const open = transfer({ vis_no: 'open', status_code: '130', percent_complete: '90' })
    expect(pickVisTransfer([open, done])?.vis_no).toBe('done')
  })

  // A refusal is the answer to "why has nothing happened", so hiding it would
  // leave the row looking untouched.
  it('falls back to a dead row when that is all there is', () => {
    const refused = transfer({ vis_no: 'refused', status_code: '255' })
    expect(pickVisTransfer([refused])?.vis_no).toBe('refused')
    expect(pickVisTransfer([])).toBeNull()
    expect(pickVisTransfer(undefined)).toBeNull()
  })
})

describe('visPhaseI18nKey — the phase is printed only when it agrees with the badge', () => {
  it('says nothing for a finished ITC still sitting at code 130', () => {
    const t = transfer({ status_code: '130', percent_complete: '100' })
    // "Transfer complete · In progress" reads as a contradiction and invites
    // somebody to re-open a settled case.
    expect(visPhaseI18nKey(t, 'complete')).toBeNull()
  })

  it('names the phase while genuinely in progress', () => {
    const t = transfer({ status_code: '130', percent_complete: '20' })
    expect(visPhaseI18nKey(t, 'in_progress')).toBe('trVisPhaseInProgress')
  })

  it('names the phase once VIS itself says ended', () => {
    expect(visPhaseI18nKey(transfer({ status_code: '200' }), 'complete')).toBe('trVisPhaseEnded')
  })

  it('shows nothing rather than inventing a phase for an unmapped code', () => {
    expect(visPhaseI18nKey(transfer({ status_code: '77' }), 'in_progress')).toBeNull()
  })
})

describe('normaliseVisPlayerNo — the guard that stopped a no-op save from wiping a confirmation', () => {
  it('reads the string the API actually returns', () => {
    expect(normaliseVisPlayerNo('4471')).toBe(4471)
    expect(normaliseVisPlayerNo(' 4471 ')).toBe(4471)
    expect(normaliseVisPlayerNo(4471)).toBe(4471)
  })

  // The bug: `Number(trimmed) === m.vis_player_no_manual` compared 4471 to
  // '4471', so re-saving an unchanged link always wrote and replaced the sweep's
  // green "VIS: MUELLER, Anna" confirmation with the amber "unconfirmed"
  // warning — while toasting success.
  it('makes an unchanged link compare equal', () => {
    expect(normaliseVisPlayerNo('4471')).toBe(normaliseVisPlayerNo(4471))
  })

  it('answers null for every absence and every impossible number', () => {
    expect(normaliseVisPlayerNo(null)).toBeNull()
    expect(normaliseVisPlayerNo(undefined)).toBeNull()
    expect(normaliseVisPlayerNo('')).toBeNull()
    expect(normaliseVisPlayerNo('   ')).toBeNull()
    expect(normaliseVisPlayerNo('abc')).toBeNull()
    // 0 would silently index the transfers map at key 0; a negative is not a
    // VIS player number at all.
    expect(normaliseVisPlayerNo('0')).toBeNull()
    expect(normaliseVisPlayerNo(0)).toBeNull()
    expect(normaliseVisPlayerNo('-5')).toBeNull()
    expect(normaliseVisPlayerNo(-5)).toBeNull()
  })
})
