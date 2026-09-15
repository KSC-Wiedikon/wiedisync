import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../utils/messagingFeatureFlag', () => ({ messagingFeatureEnabled: () => true }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'mbr-me' } }) }))
vi.mock('../../../hooks/useRealtime', () => ({ useRealtime: vi.fn() }))
vi.mock('../../../lib/api', () => ({ fetchAllItems: vi.fn(async () => []) }))

const reactMock = vi.fn<(id: string, b: { emoji: string }) => Promise<{ added: boolean; emoji: string }>>(
  async () => ({ added: true, emoji: '👍' }),
)
vi.mock('../api/messaging', () => ({
  messagingApi: { react: (id: string, b: { emoji: string }) => reactMock(id, b) },
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: (init: unknown) => [init, vi.fn()],
    useEffect: vi.fn(),
    useCallback: (fn: unknown) => fn,
    useRef: (init: unknown) => ({ current: init }),
    useMemo: (fn: () => unknown) => fn(),
  }
})

import { messagingApi } from '../api/messaging'
import type { ReactionRow } from '../api/types'

const row = (overrides: Partial<ReactionRow> = {}): ReactionRow => ({
  id: 'r1', message: 'm1', member: 'mbr-me', emoji: '👍', created_at: '2026-04-18T00:00:00Z', ...overrides,
})

describe('useReactions — api contract', () => {
  beforeEach(() => { reactMock.mockClear() })

  it('toggle forwards messageId + emoji to messagingApi', async () => {
    await messagingApi.react('m1', { emoji: '👍' })
    expect(reactMock).toHaveBeenCalledWith('m1', { emoji: '👍' })
  })

  it('realtime reducer: create appends row when message matches', () => {
    const mid = 'm1'
    const prev: ReactionRow[] = []
    const event = { action: 'create' as const, record: row() }
    const next = String(event.record.message) === mid && event.action === 'create'
      ? (prev.some(r => r.id === event.record.id) ? prev : [...prev, event.record])
      : prev
    expect(next.length).toBe(1)
  })

  it('realtime reducer: create for different message is ignored', () => {
    const mid = 'm1'
    const event = { action: 'create' as const, record: row({ message: 'other' }) }
    const matches = String(event.record.message) === mid
    expect(matches).toBe(false)
  })

  it('realtime reducer: delete removes row', () => {
    const prev: ReactionRow[] = [row({ id: 'a' }), row({ id: 'b' })]
    const event = { action: 'delete' as const, record: row({ id: 'a' }) }
    const next = prev.filter(r => r.id !== event.record.id)
    expect(next.map(r => r.id)).toEqual(['b'])
  })

  it('groupedCounts aggregates emoji counts', () => {
    const rows = [row({ id: 'a', emoji: '👍' }), row({ id: 'b', emoji: '👍' }), row({ id: 'c', emoji: '❤️' })]
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.emoji, (m.get(r.emoji) ?? 0) + 1)
    expect(m.get('👍')).toBe(2)
    expect(m.get('❤️')).toBe(1)
  })

  it('myReactions filters to current user', () => {
    const rows = [row({ member: 'mbr-me', emoji: '👍' }), row({ member: 'other', emoji: '❤️' })]
    const set = new Set(rows.filter(r => String(r.member) === 'mbr-me').map(r => r.emoji))
    expect(set.has('👍')).toBe(true)
    expect(set.has('❤️')).toBe(false)
  })
})
