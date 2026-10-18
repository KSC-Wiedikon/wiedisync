import { describe, it, expect } from 'vitest'
import { showsWieplayLink } from './wieplay'

const today = '2026-10-18'
const ctx = { teamUsesWieplay: true, viewerOnTeam: true, today }

describe('showsWieplayLink', () => {
  it('links played games and today’s game', () => {
    expect(showsWieplayLink({ date: '2026-10-11', status: 'completed' }, ctx)).toBe(true)
    expect(showsWieplayLink({ date: '2026-10-18', status: 'scheduled' }, ctx)).toBe(true)
    expect(showsWieplayLink({ date: '2026-10-18', status: 'live' }, ctx)).toBe(true)
    // A played game whose result has not synced yet is still `scheduled`.
    expect(showsWieplayLink({ date: '2026-10-17', status: 'scheduled' }, ctx)).toBe(true)
    // Directus may hand a date with a time part.
    expect(showsWieplayLink({ date: '2026-10-11T00:00:00', status: 'completed' }, ctx)).toBe(true)
  })

  it('never links a game still to come, or one without a date', () => {
    expect(showsWieplayLink({ date: '2026-10-19', status: 'scheduled' }, ctx)).toBe(false)
    expect(showsWieplayLink({ date: null, status: 'scheduled' }, ctx)).toBe(false)
    expect(showsWieplayLink({ date: '', status: 'completed' }, ctx)).toBe(false)
  })

  it('never links a cancelled or postponed game', () => {
    expect(showsWieplayLink({ date: '2026-10-11', status: 'cancelled' }, ctx)).toBe(false)
    expect(showsWieplayLink({ date: '2026-10-11', status: 'postponed' }, ctx)).toBe(false)
  })

  it('only for a team that uses WiePlay, and a viewer on it', () => {
    const played = { date: '2026-10-11', status: 'completed' }
    expect(showsWieplayLink(played, { ...ctx, teamUsesWieplay: false })).toBe(false)
    expect(showsWieplayLink(played, { ...ctx, viewerOnTeam: false })).toBe(false)
  })
})
