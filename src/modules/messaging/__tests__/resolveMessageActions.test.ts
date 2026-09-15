import { describe, it, expect } from 'vitest'
import { resolveMessageActions } from '../utils/resolveMessageActions'
import type { MessageRow } from '../api/types'

const msg = (overrides: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm1', conversation: 'c1', sender: 'A', type: 'text',
  body: 'hi', poll: null, created_at: '2026-04-18T00:00:00Z',
  edited_at: null, deleted_at: null, ...overrides,
})

describe('resolveMessageActions', () => {
  it('empty set when no currentMemberId', () => {
    expect(resolveMessageActions(msg(), null, { isTeamModerator: false }).size).toBe(0)
  })

  it('empty set when message is soft-deleted', () => {
    expect(resolveMessageActions(msg({ deleted_at: '2026-04-18T00:00:00Z' }), 'A', { isTeamModerator: true }).size).toBe(0)
  })

  it('empty set for poll messages', () => {
    expect(resolveMessageActions(msg({ type: 'poll' }), 'A', { isTeamModerator: true }).size).toBe(0)
  })

  it('self: edit + delete (no report)', () => {
    const res = resolveMessageActions(msg({ sender: 'me' }), 'me', { isTeamModerator: false })
    expect(res.has('edit')).toBe(true)
    expect(res.has('delete')).toBe(true)
    expect(res.has('report')).toBe(false)
  })

  it('non-self non-moderator: report only', () => {
    const res = resolveMessageActions(msg({ sender: 'A' }), 'me', { isTeamModerator: false })
    expect(res.has('report')).toBe(true)
    expect(res.has('delete')).toBe(false)
    expect(res.has('edit')).toBe(false)
  })

  it('non-self + team moderator: delete + report', () => {
    const res = resolveMessageActions(msg({ sender: 'A' }), 'me', { isTeamModerator: true })
    expect(res.has('delete')).toBe(true)
    expect(res.has('report')).toBe(true)
    expect(res.has('edit')).toBe(false)
  })

  it('numeric-string id comparison coerced', () => {
    const res = resolveMessageActions(msg({ sender: 42 as unknown as string }), '42', { isTeamModerator: false })
    expect(res.has('edit')).toBe(true)
    expect(res.has('delete')).toBe(true)
  })
})
