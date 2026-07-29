import { describe, it, expect } from 'vitest'
import { m2mUpdatePayload, teamToM2M } from './api'

/**
 * Regression guard for the 2026-07-29 "has to be unique" 400s.
 *
 * Migration 245 put a composite unique index on every junction table
 * (`events_teams_pair_uq` & friends). Directus treats a junction object with no
 * primary key as a CREATE and only removes the dropped rows afterwards, so
 * re-sending an unchanged link as a bare `{ teams_id }` INSERTs a duplicate
 * while the original still exists — every edit form that re-submitted its
 * unchanged team list started 400ing.
 */
describe('m2mUpdatePayload', () => {
  const existing = [
    { id: 14, teams_id: 92 },
    { id: 15, teams_id: 80 },
  ]

  it('sends the junction row PK back for links that already exist', () => {
    expect(m2mUpdatePayload('teams_id', ['92', '80'], existing)).toEqual([
      { id: 14, teams_id: '92' },
      { id: 15, teams_id: '80' },
    ])
  })

  it('leaves genuinely new links PK-less so Directus inserts them', () => {
    expect(m2mUpdatePayload('teams_id', ['92', '97'], existing)).toEqual([
      { id: 14, teams_id: '92' },
      { teams_id: '97' },
    ])
  })

  it('drops removed links by omitting them (Directus deletes the leftovers)', () => {
    expect(m2mUpdatePayload('teams_id', ['80'], existing)).toEqual([{ id: 15, teams_id: '80' }])
  })

  it('matches numeric and string related IDs interchangeably', () => {
    expect(m2mUpdatePayload('teams_id', [92], existing)).toEqual([{ id: 14, teams_id: 92 }])
  })

  it('reads the related ID out of an expanded junction object', () => {
    const expanded = [{ id: 14, teams_id: { id: 92, name: 'H3' } }]
    expect(m2mUpdatePayload('teams_id', ['92'], expanded)).toEqual([{ id: 14, teams_id: '92' }])
  })

  it('works on other junction fields', () => {
    const staff = [{ id: 3, members_id: 8 }]
    expect(m2mUpdatePayload('members_id', ['8', '11'], staff)).toEqual([
      { id: 3, members_id: '8' },
      { members_id: '11' },
    ])
  })

  it('falls back to plain creates when the fetch omitted the junction PK', () => {
    // `teams.teams_id` without `teams.id` — the shape that caused the outage.
    expect(m2mUpdatePayload('teams_id', ['92'], [{ teams_id: 92 }])).toEqual([{ teams_id: '92' }])
  })

  it('handles a missing / non-array `existing` (create path)', () => {
    expect(m2mUpdatePayload('teams_id', ['92'], undefined)).toEqual([{ teams_id: '92' }])
    expect(m2mUpdatePayload('teams_id', ['92'], null)).toEqual([{ teams_id: '92' }])
    expect(m2mUpdatePayload('teams_id', [], existing)).toEqual([])
  })

  it('ignores bare junction IDs, which carry no related-ID information', () => {
    expect(m2mUpdatePayload('teams_id', ['92'], [14, 15])).toEqual([{ teams_id: '92' }])
  })
})

describe('teamToM2M', () => {
  it('swaps the flat `team` array for a junction payload that keeps PKs', () => {
    const out = teamToM2M({ label: 'VB - H3', team: ['92'] }, [{ id: 7, teams_id: 92 }])
    expect(out).toEqual({ label: 'VB - H3', teams: [{ id: 7, teams_id: '92' }] })
  })

  it('strips `team` and adds nothing when it is not an array', () => {
    expect(teamToM2M({ label: 'x' })).toEqual({ label: 'x' })
  })
})
