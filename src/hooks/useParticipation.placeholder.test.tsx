// @vitest-environment happy-dom
//
// `keepPreviousData` is a global query default (lib/query.tsx), and the roster and
// detail modals aren't remounted between activities. So right after the activity
// changes, these hooks' queries still hold the PREVIOUS activity's rows, with
// isLoading false. Uses the real query client, so that default is what's under test.
//
// Reported 06.11.2026: a training's participation list showed the previously opened
// training's answers, then corrected itself. The viewer's own row had the same hole,
// where an answer tapped in that window updated the previous activity's row.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'

const h = vi.hoisted(() => ({
  fetchAllItems: vi.fn(),
  fetchItems: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  auth: { user: { id: 'viewer' } },
  absence: { hasAbsence: false },
  i18n: { t: (key: string) => key },
}))

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchAllItems: h.fetchAllItems,
  fetchItems: h.fetchItems,
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => h.i18n,
}))
vi.mock('./useAuth', () => ({ useAuth: () => h.auth }))
vi.mock('./useRealtime', () => ({ useRealtime: () => {} }))
vi.mock('./useMyCoveringAbsence', () => ({ useMyCoveringAbsence: () => h.absence }))
vi.mock('./useMutation', () => ({
  useMutation: () => ({ create: h.create, update: h.update, remove: h.remove }),
}))

import { queryClient } from '../lib/query'
import { useAllEventParticipations, useParticipation, useTeamParticipations } from './useParticipation'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (id: string, activityId: string, member = 'p1') =>
  ({ id, member, activity_type: 'training', activity_id: activityId, status: 'confirmed', is_staff: false, guest_count: 0 })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('hooks reading an activity through the global keepPreviousData', () => {
  let root: Root
  const defaults = queryClient.getDefaultOptions()

  // Two steps: React only runs the render when the first `act` ends, so the query
  // starts there, and it delivers its result over a few ticks after that.
  const settle = async (step?: () => void) => {
    await act(async () => { step?.() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  }
  const mount = (ui: ReactNode) => settle(() => {
    root.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  })

  beforeEach(() => {
    queryClient.clear()
    // Query's own retry waits a second: these tests don't need to.
    queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } })
    for (const mock of [h.fetchAllItems, h.fetchItems, h.create, h.update, h.remove]) mock.mockReset()
    root = createRoot(document.createElement('div'))
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    queryClient.setDefaultOptions(defaults)
  })

  describe('useTeamParticipations (the roster modal)', () => {
    type Result = ReturnType<typeof useTeamParticipations>
    let result: Result
    const expose = (r: Result) => { result = r }
    function Probe({ activityId, memberIds }: { activityId: string; memberIds: string[] }) {
      const r = useTeamParticipations('training', activityId, memberIds)
      useEffect(() => { expose(r) })
      return null
    }
    const render = (activityId: string, memberIds = ['p1']) =>
      mount(<Probe activityId={activityId} memberIds={memberIds} />)

    it('never hands over the previous activity\'s answers while the new ones load', async () => {
      h.fetchAllItems.mockResolvedValueOnce([row('a1', 'A')])
      await render('A')
      expect(result.participations.map((p) => p.id)).toEqual(['a1'])

      const b = deferred<unknown[]>()
      h.fetchAllItems.mockReturnValueOnce(b.promise)
      await render('B')
      expect(result.participations).toEqual([])
      expect(result.isLoading).toBe(true)

      await settle(() => b.resolve([row('b1', 'B')]))
      expect(result.participations.map((p) => p.id)).toEqual(['b1'])
      expect(result.isLoading).toBe(false)
    })

    it('does the same across a close and reopen, which is how the modal switches', async () => {
      h.fetchAllItems.mockResolvedValueOnce([row('a1', 'A')])
      await render('A')
      expect(result.participations).toHaveLength(1)
      await render('', [])

      const b = deferred<unknown[]>()
      h.fetchAllItems.mockReturnValueOnce(b.promise)
      await render('B')
      expect(result.participations).toEqual([])
      expect(result.isLoading).toBe(true)
      await settle(() => b.resolve([]))
      expect(result.isLoading).toBe(false)
    })

    it('does not load forever for a team with nobody on it', async () => {
      h.fetchAllItems.mockResolvedValueOnce([row('a1', 'A')])
      await render('A')
      expect(result.participations).toHaveLength(1)
      await render('B', [])
      expect(result.participations).toEqual([])
      expect(result.isLoading).toBe(false)
    })

    it('reports a failed load for the new activity, without the old rows', async () => {
      h.fetchAllItems.mockResolvedValueOnce([row('a1', 'A')])
      await render('A')
      expect(result.participations).toHaveLength(1)
      h.fetchAllItems.mockRejectedValueOnce(new Error('Service Unavailable'))
      await render('B')
      expect(result.participations).toEqual([])
      expect(result.isLoading).toBe(false)
      expect(result.loadFailed).toBe(true)
    })

    it('keeps the list on screen during a refresh of the same activity', async () => {
      h.fetchAllItems.mockResolvedValueOnce([row('a1', 'A')])
      await render('A')
      const refresh = deferred<unknown[]>()
      h.fetchAllItems.mockReturnValueOnce(refresh.promise)
      await settle(() => { void result.refetch() })
      expect(result.participations.map((p) => p.id)).toEqual(['a1'])
      expect(result.isLoading).toBe(false)
      await settle(() => refresh.resolve([row('a1', 'A')]))
    })
  })

  describe('useAllEventParticipations (the Overall tab)', () => {
    type Result = ReturnType<typeof useAllEventParticipations>
    let result: Result
    const expose = (r: Result) => { result = r }
    function Probe({ activityId }: { activityId: string }) {
      const r = useAllEventParticipations(activityId, ['p1'])
      useEffect(() => { expose(r) })
      return null
    }

    it('never hands over the previous event\'s answers', async () => {
      h.fetchAllItems.mockResolvedValueOnce([row('a1', 'A')])
      await mount(<Probe activityId="A" />)
      expect(result.participations).toHaveLength(1)

      const b = deferred<unknown[]>()
      h.fetchAllItems.mockReturnValueOnce(b.promise)
      await mount(<Probe activityId="B" />)
      expect(result.participations).toEqual([])
      expect(result.isLoading).toBe(true)
      await settle(() => b.resolve([]))
    })
  })

  describe('useParticipation (the viewer\'s own answer)', () => {
    type Result = ReturnType<typeof useParticipation>
    let result: Result
    const expose = (r: Result) => { result = r }
    function Probe({ activityId }: { activityId: string }) {
      const r = useParticipation('training', activityId)
      useEffect(() => { expose(r) })
      return null
    }

    it('does not show the previous activity\'s answer as this one\'s', async () => {
      h.fetchItems.mockResolvedValueOnce([row('a1', 'A', 'viewer')])
      await mount(<Probe activityId="A" />)
      expect(result.participation?.id).toBe('a1')

      const b = deferred<unknown[]>()
      h.fetchItems.mockReturnValueOnce(b.promise)
      await mount(<Probe activityId="B" />)
      expect(result.participation).toBeNull()
      expect(result.isLoading).toBe(true)

      await settle(() => b.resolve([row('b1', 'B', 'viewer')]))
      expect(result.participation?.id).toBe('b1')
      expect(result.isLoading).toBe(false)
    })

    it('never writes an answer tapped in that window onto the previous activity\'s row', async () => {
      h.fetchItems.mockResolvedValueOnce([row('a1', 'A', 'viewer')])
      await mount(<Probe activityId="A" />)
      expect(result.participation?.id).toBe('a1')

      const b = deferred<unknown[]>()
      h.fetchItems.mockReturnValueOnce(b.promise)
      await mount(<Probe activityId="B" />)

      h.create.mockResolvedValueOnce({ id: 'b-new', status: 'declined' })
      await act(async () => { await result.setStatus('declined') })

      expect(h.update).not.toHaveBeenCalled()
      expect(h.create).toHaveBeenCalledTimes(1)
      expect(h.create.mock.calls[0][0]).toMatchObject({ activity_id: 'B', status: 'declined' })

      await settle(() => b.resolve([]))
    })

    it('does not load forever when there is no activity', async () => {
      h.fetchItems.mockResolvedValueOnce([row('a1', 'A', 'viewer')])
      await mount(<Probe activityId="A" />)
      expect(result.participation?.id).toBe('a1')
      await mount(<Probe activityId="" />)
      expect(result.isLoading).toBe(false)
      expect(result.participation).toBeNull()
    })
  })
})
