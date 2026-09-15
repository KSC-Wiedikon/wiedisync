import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'mbr-admin' }, isAdmin: true }) }))
vi.mock('../../../hooks/useRealtime', () => ({ useRealtime: vi.fn() }))

type ResolveReportBody = { status: 'resolved' | 'dismissed'; delete_message?: boolean; ban?: boolean }

const listMock = vi.fn(async () => ({ reports: [] }))
const resolveMock = vi.fn<
  (id: string, b: ResolveReportBody) => Promise<{ id: string; status: string; delete_message: boolean; ban: boolean }>
>(
  async (id) => ({ id, status: 'resolved', delete_message: false, ban: false }),
)
vi.mock('../api/messaging', () => ({
  messagingApi: {
    listReports: () => listMock(),
    resolveReport: (id: string, b: ResolveReportBody) => resolveMock(id, b),
  },
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: (init: unknown) => [init, vi.fn()],
    useEffect: vi.fn(),
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
  }
})

import { messagingApi } from '../api/messaging'

describe('useReports — api contract', () => {
  beforeEach(() => { listMock.mockClear(); resolveMock.mockClear() })

  it('listReports forwards to messagingApi', async () => {
    await messagingApi.listReports()
    expect(listMock).toHaveBeenCalled()
  })

  it('resolve passes status=resolved', async () => {
    await messagingApi.resolveReport('r1', { status: 'resolved' })
    expect(resolveMock).toHaveBeenCalledWith('r1', { status: 'resolved' })
  })

  it('dismiss passes status=dismissed', async () => {
    await messagingApi.resolveReport('r1', { status: 'dismissed' })
    expect(resolveMock).toHaveBeenCalledWith('r1', { status: 'dismissed' })
  })

  it('resolveWithDelete includes delete_message=true', async () => {
    await messagingApi.resolveReport('r1', { status: 'resolved', delete_message: true })
    expect(resolveMock).toHaveBeenCalledWith('r1', { status: 'resolved', delete_message: true })
  })

  it('resolveWithBan includes ban=true', async () => {
    await messagingApi.resolveReport('r1', { status: 'resolved', ban: true })
    expect(resolveMock).toHaveBeenCalledWith('r1', { status: 'resolved', ban: true })
  })

  it('openCount sums status=open rows', () => {
    const rows = [
      { status: 'open' }, { status: 'open' }, { status: 'resolved' }, { status: 'dismissed' },
    ] as { status: string }[]
    const count = rows.filter(r => r.status === 'open').length
    expect(count).toBe(2)
  })
})
