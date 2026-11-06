// @vitest-environment happy-dom
//
// useMultiTeamMembers when the roster request fails: the failure stays visible in
// `error` (an empty `members` alone looks like a team with nobody on it), a retry
// is a loading state until it lands, and reopening starts clean.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const { fetchAllItems } = vi.hoisted(() => ({ fetchAllItems: vi.fn() }))
vi.mock('../lib/api', () => ({ fetchAllItems, fetchItem: vi.fn(), updateRecord: vi.fn() }))

import { useMultiTeamMembers } from './useTeamMembers'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type HookResult = ReturnType<typeof useMultiTeamMembers>
let result: HookResult
const expose = (r: HookResult) => { result = r }
function Probe({ teamIds }: { teamIds: string[] }) {
  const r = useMultiTeamMembers(teamIds)
  useEffect(() => { expose(r) })
  return null
}

const row = { id: 'mt1', member: { id: 'p1', first_name: 'Fake' }, team: '92', guest_level: 0 }

describe('useMultiTeamMembers on a failed roster request', () => {
  let root: Root
  const render = (teamIds: string[]) => act(async () => { root.render(<Probe teamIds={teamIds} />) })

  beforeEach(() => {
    fetchAllItems.mockReset()
    root = createRoot(document.createElement('div'))
  })
  afterEach(() => act(async () => { root.unmount() }))

  it('reports the failure instead of settling on an empty roster alone', async () => {
    fetchAllItems.mockRejectedValue(new Error('Service Unavailable'))
    await render(['92'])
    expect(result.isLoading).toBe(false)
    expect(result.members).toEqual([])
    expect(result.error?.message).toBe('Service Unavailable')
  })

  it('stays loading during a retry, then delivers the roster', async () => {
    fetchAllItems.mockRejectedValueOnce(new Error('Service Unavailable'))
    await render(['92'])

    let land!: (rows: unknown[]) => void
    fetchAllItems.mockReturnValueOnce(new Promise((resolve) => { land = resolve }))
    let retry!: Promise<void>
    await act(async () => { retry = result.refetch() })
    expect(result.isLoading).toBe(true)
    expect(result.error).toBeNull()

    await act(async () => { land([row]); await retry })
    expect(result.isLoading).toBe(false)
    expect(result.error).toBeNull()
    expect(result.members).toHaveLength(1)
  })

  it('keeps the failure when the retry fails too', async () => {
    fetchAllItems.mockRejectedValue(new Error('Service Unavailable'))
    await render(['92'])
    await act(async () => { await result.refetch() })
    expect(result.isLoading).toBe(false)
    expect(result.error?.message).toBe('Service Unavailable')
  })

  it('starts clean when the modal is closed and opened again', async () => {
    fetchAllItems.mockRejectedValueOnce(new Error('Service Unavailable'))
    await render(['92'])
    expect(result.error).not.toBeNull()

    await render([])
    fetchAllItems.mockResolvedValueOnce([row])
    await render(['92'])
    expect(result.error).toBeNull()
    expect(result.members).toHaveLength(1)
  })
})
