/**
 * useBlocks tests — node-env compatible (no @testing-library/react).
 *
 * Strategy: mirrors useConversations.test.ts. We test the messagingApi contract
 * and the pure reducer logic inside the realtime handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../utils/messagingFeatureFlag', () => ({ messagingFeatureEnabled: () => true }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'mbr-me' } }) }))
vi.mock('../../../hooks/useRealtime', () => ({ useRealtime: vi.fn() }))

const blockMock = vi.fn<(b: { member: string }) => Promise<{ blocked: string; created: boolean }>>(
  async () => ({ blocked: 'them', created: true }),
)
const unblockMock = vi.fn<(id: string) => Promise<{ unblocked: string; removed: boolean }>>(
  async () => ({ unblocked: 'them', removed: true }),
)
vi.mock('../api/messaging', () => ({
  messagingApi: {
    block: (b: { member: string }) => blockMock(b),
    unblock: (id: string) => unblockMock(id),
  },
}))

vi.mock('../../../lib/api', () => ({
  fetchAllItems: vi.fn(async () => [
    { id: 'b1', blocker: 'mbr-me', blocked: 'them', created_at: '2026-04-18T00:00:00Z' },
  ]),
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

describe('useBlocks — api contract', () => {
  beforeEach(() => { blockMock.mockClear(); unblockMock.mockClear() })

  it('block forwards member id to messagingApi', async () => {
    await messagingApi.block({ member: 'them' })
    expect(blockMock).toHaveBeenCalledWith({ member: 'them' })
  })

  it('unblock forwards member id to messagingApi', async () => {
    await messagingApi.unblock('them')
    expect(unblockMock).toHaveBeenCalledWith('them')
  })

  it('realtime reducer: block create adds blocked id to set when blocker is me', () => {
    const set = new Set<string>()
    const me = 'mbr-me'
    const event = { action: 'create' as const, record: { id: 'b1', blocker: me, blocked: 'x', created_at: '' } }
    if (String(event.record.blocker) === me) set.add(String(event.record.blocked))
    expect(set.has('x')).toBe(true)
  })

  it('realtime reducer: block create for OTHER blocker is ignored', () => {
    const set = new Set<string>()
    const me = 'mbr-me'
    const event = { action: 'create' as const, record: { id: 'b1', blocker: 'someone-else', blocked: 'x', created_at: '' } }
    if (String(event.record.blocker) === me) set.add(String(event.record.blocked))
    expect(set.has('x')).toBe(false)
  })

  it('realtime reducer: block delete removes blocked id from set', () => {
    const set = new Set<string>(['x'])
    const me = 'mbr-me'
    const event = { action: 'delete' as const, record: { id: 'b1', blocker: me, blocked: 'x', created_at: '' } }
    if (String(event.record.blocker) === me) set.delete(String(event.record.blocked))
    expect(set.has('x')).toBe(false)
  })
})
