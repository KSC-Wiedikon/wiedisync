/**
 * Unit tests for the "Fix groups" commit gate (clubdesk-update.js).
 *
 * The invariant (20.10.2026): a commit is judged by the ROWS the preview could
 * write, not by "a preview happened". That day a preview in which all 17 rows came
 * back `skip_filter_failed` unlocked a commit, which skipped the same 17 rows and
 * was reported as done. Now:
 *   • a preview with no OK row refuses the commit (`preview_nothing_writable`);
 *   • a row the preview never showed still refuses it (`preview_stale`);
 *   • otherwise only the preview's OK rows are committed — a row it skipped is
 *     held back, never retried blind.
 *
 * Also pins the OK status set against its two twins (dispatcher helper + UI), so
 * the three layers cannot drift apart silently.
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  GROUP_FIX_OK_STATUSES, groupFixAddRowKey, groupFixRemoveRowKey,
  previewedRowKeys, previewedOkRowKeys, planGroupFixCommit,
} from '../clubdesk-update.js'

const addA = { name: 'Fretz Finn', group: 'VB H2', funktion: 'Spieler*in', clubdesk_id: '1000886' }
const addB = { name: 'Muster Anna', group: 'VB D1', funktion: 'Spieler*in', clubdesk_id: '1000123' }
const remC = { name: 'Weg Paul', uuid: 'c0ffee00-0000-4000-8000-000000000001', group_label: 'BB Herren 2 (Spieler*in)' }

/** A preview summary the dispatcher stores in grp_result. */
const preview = (adds, removes) => ({
  mode: 'preview',
  add: adds ? { mode: 'preview', count: adds.length, results: adds } : null,
  remove: removes ? { mode: 'preview', count: removes.length, results: removes } : null,
})

describe('GROUP_FIX_OK_STATUSES', () => {
  it('is exactly assigned / previewed / removed', () => {
    expect([...GROUP_FIX_OK_STATUSES].sort()).toEqual(['assigned', 'previewed', 'removed'])
  })

  it('matches the dispatcher helper and the UI — one set, three layers', () => {
    const root = fileURLToPath(new URL('../../../../../', import.meta.url))
    const sh = readFileSync(`${root}directus/scripts/clubdesk-group-fix-outcome.sh`, 'utf8')
    const shSet = sh.match(/^GRP_OK_STATUSES="([^"]*)"/m)?.[1].split(/\s+/).filter(Boolean)
    const tsx = readFileSync(`${root}src/modules/admin/utils/groupFixOutcome.ts`, 'utf8')
    const tsxSet = tsx.match(/export const OK_STATUSES = new Set\(\[([^\]]*)\]\)/)?.[1]
      .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
    expect(shSet?.sort()).toEqual([...GROUP_FIX_OK_STATUSES].sort())
    expect(tsxSet?.sort()).toEqual([...GROUP_FIX_OK_STATUSES].sort())
  })
})

describe('previewedRowKeys / previewedOkRowKeys', () => {
  const prev = preview(
    [{ ...addA, status: 'previewed' }, { ...addB, status: 'skip_filter_failed' }],
    [{ ...remC, status: 'skip_not_in_group' }],
  )

  it('every reported row is "seen", skips included', () => {
    const seen = previewedRowKeys(prev)
    expect(seen.size).toBe(3)
    expect(seen.has(groupFixAddRowKey(addB))).toBe(true)
    expect(seen.has(groupFixRemoveRowKey(remC))).toBe(true)
  })

  it('only OK rows are writable', () => {
    const ok = previewedOkRowKeys(prev)
    expect([...ok]).toEqual([groupFixAddRowKey(addA)])
  })

  it('tolerates a null summary and a missing results array', () => {
    expect(previewedOkRowKeys(null).size).toBe(0)
    expect(previewedOkRowKeys({ add: { mode: 'preview' }, remove: null }).size).toBe(0)
  })
})

describe('planGroupFixCommit', () => {
  it('refuses a preview in which nothing was writable (the 20.10.2026 run)', () => {
    const allSkipped = preview(
      [addA, addB].map((r) => ({ ...r, status: 'skip_filter_failed' })),
      [{ ...remC, status: 'skip_filter_failed' }],
    )
    const plan = planGroupFixCommit(allSkipped, { add: [addA, addB], remove: [remC] })
    expect(plan.error?.code).toBe('preview_nothing_writable')
    expect(plan.add).toBeUndefined()
  })

  it('refuses a preview whose tools died before reporting any row', () => {
    const died = { mode: 'preview', add: { mode: 'preview', count: 2, results: [], fatal: 'no Wiedisync ID column' }, remove: null }
    expect(planGroupFixCommit(died, { add: [addA, addB] }).error?.code).toBe('preview_nothing_writable')
  })

  it('still refuses a row the preview never showed', () => {
    const prev = preview([{ ...addA, status: 'previewed' }], null)
    const plan = planGroupFixCommit(prev, { add: [addA, addB], remove: [] })
    expect(plan.error?.code).toBe('preview_stale')
    expect(plan.error?.unseen).toBe(1)
  })

  it('commits only the OK rows and holds back the skipped ones', () => {
    const prev = preview(
      [{ ...addA, status: 'previewed' }, { ...addB, status: 'skip_ok_disabled' }],
      [{ ...remC, status: 'previewed' }],
    )
    const plan = planGroupFixCommit(prev, { add: [addA, addB], remove: [remC] })
    expect(plan.error).toBeUndefined()
    expect(plan.add).toEqual([addA])
    expect(plan.remove).toEqual([remC])
    expect(plan.heldBack).toBe(1)
  })

  it('a row fixed elsewhere since the preview simply drops out', () => {
    const prev = preview([{ ...addA, status: 'previewed' }, { ...addB, status: 'previewed' }], null)
    const plan = planGroupFixCommit(prev, { add: [addB], remove: [] })
    expect(plan.add).toEqual([addB])
    expect(plan.heldBack).toBe(0)
  })

  it('a clubdesk_id that round-trips as a number still matches', () => {
    const prev = preview([{ ...addA, clubdesk_id: 1000886, status: 'previewed' }], null)
    expect(planGroupFixCommit(prev, { add: [addA] }).add).toEqual([addA])
  })
})
