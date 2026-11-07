// @vitest-environment happy-dom
//
// `keepPreviousData` is a global query default (lib/query.tsx). On a screen that isn't
// remounted between items, a query keeps returning the PREVIOUS item's rows until the
// new ones land, and even while disabled. These hooks must never hand those over: they
// sit behind writes. Uses the real query client, so that default is what's under test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'

const h = vi.hoisted(() => ({
  fetchItems: vi.fn(),
  kscwApi: vi.fn(),
  auth: { user: { id: 'viewer' } },
}))

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchItems: h.fetchItems,
  kscwApi: h.kscwApi,
}))
vi.mock('./useAuth', () => ({ useAuth: () => h.auth }))

import { queryClient } from '../lib/query'
import { useEventSessions } from './useEventSessions'
import { useDeepLinkedActivity } from './useDeepLinkedActivity'
import { useCarpoolBoard } from '../modules/carpool/carpoolApi'
import { useEntryDocuments } from './useFinanceBooks'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('hooks behind a write, under the global keepPreviousData', () => {
  let root: Root
  const defaults = queryClient.getDefaultOptions()

  // Two steps: React only runs the render when the first `act` ends, so the query starts
  // there, and it delivers its result over a few ticks after that.
  const settle = async (step?: () => void) => {
    await act(async () => { step?.() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
  }
  const mount = (ui: ReactNode) => settle(() => {
    root.render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  })

  beforeEach(() => {
    queryClient.clear()
    queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } })
    h.fetchItems.mockReset()
    h.kscwApi.mockReset()
    root = createRoot(document.createElement('div'))
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    queryClient.setDefaultOptions(defaults)
  })

  describe('useEventSessions', () => {
    let result: ReturnType<typeof useEventSessions>
    const expose = (r: typeof result) => { result = r }
    function Probe({ id, enabled = true }: { id?: string; enabled?: boolean }) {
      const r = useEventSessions(id, enabled)
      useEffect(() => { expose(r) })
      return null
    }
    const dayOf = (event: string) => [{ id: `${event}-day`, event, date: '2026-11-07' }]

    it('never hands over the previous event\'s days while the next ones load', async () => {
      h.fetchItems.mockResolvedValueOnce(dayOf('A'))
      await mount(<Probe id="A" />)
      expect(result.sessions.map((s) => s.id)).toEqual(['A-day'])

      const b = deferred<unknown[]>()
      h.fetchItems.mockReturnValueOnce(b.promise)
      await mount(<Probe id="B" />)
      expect(result.sessions).toEqual([])
      expect(result.rows).toBeUndefined()
      expect(result.isLoading).toBe(true)

      await settle(() => b.resolve(dayOf('B')))
      expect(result.sessions.map((s) => s.id)).toEqual(['B-day'])
      expect(result.isLoading).toBe(false)
    })

    // The data-loss case: EventForm's sync deletes every "existing" session not among the
    // drafts, so a new event inheriting the last event's rows deleted them.
    it('holds nothing for a new event after another was edited, and does not spin', async () => {
      h.fetchItems.mockResolvedValueOnce(dayOf('A'))
      await mount(<Probe id="A" />)
      expect(result.sessions).toHaveLength(1)

      await mount(<Probe id={undefined} />)
      expect(result.sessions).toEqual([])
      expect(result.isLoading).toBe(false)
    })

    it('does not spin for a whole-event activity, whose query stays disabled', async () => {
      h.fetchItems.mockResolvedValueOnce(dayOf('A'))
      await mount(<Probe id="A" />)
      expect(result.sessions).toHaveLength(1)

      await mount(<Probe id="B" enabled={false} />)
      expect(result.sessions).toEqual([])
      expect(result.isLoading).toBe(false)
    })

    it('stops loading when the read fails, without the old rows', async () => {
      h.fetchItems.mockResolvedValueOnce(dayOf('A'))
      await mount(<Probe id="A" />)
      expect(result.sessions).toHaveLength(1)

      h.fetchItems.mockRejectedValueOnce(new Error('Service Unavailable'))
      await mount(<Probe id="B" />)
      expect(result.sessions).toEqual([])
      expect(result.isLoading).toBe(false)
    })
  })

  describe('useDeepLinkedActivity', () => {
    type Row = { id: string }
    let result: ReturnType<typeof useDeepLinkedActivity<Row>>
    const expose = (r: typeof result) => { result = r }
    function Probe({ id }: { id?: string }) {
      const r = useDeepLinkedActivity<Row>('events', id, ['*'])
      useEffect(() => { expose(r) })
      return null
    }

    it('does not open the previous link\'s activity on the next one', async () => {
      h.fetchItems.mockResolvedValueOnce([{ id: '1' }])
      await mount(<Probe id="1" />)
      expect(result.item?.id).toBe('1')
      await mount(<Probe id={undefined} />)
      expect(result.item).toBeNull()

      const two = deferred<Row[]>()
      h.fetchItems.mockReturnValueOnce(two.promise)
      await mount(<Probe id="2" />)
      expect(result.item).toBeNull()
      expect(result.isLoading).toBe(true)
      expect(result.notFound).toBe(false)

      await settle(() => two.resolve([{ id: '2' }]))
      expect(result.item?.id).toBe('2')
      expect(result.isLoading).toBe(false)
    })

    it('does not call a good link gone because the previous one was', async () => {
      h.fetchItems.mockResolvedValueOnce([])
      await mount(<Probe id="dead" />)
      expect(result.notFound).toBe(true)

      const good = deferred<Row[]>()
      h.fetchItems.mockReturnValueOnce(good.promise)
      await mount(<Probe id="good" />)
      expect(result.notFound).toBe(false)

      await settle(() => good.resolve([{ id: 'good' }]))
      expect(result.notFound).toBe(false)
      expect(result.item?.id).toBe('good')
    })

    it('still reports a link that really is gone', async () => {
      h.fetchItems.mockResolvedValueOnce([])
      await mount(<Probe id="dead" />)
      expect(result.notFound).toBe(true)
      expect(result.item).toBeNull()
    })
  })

  describe('useCarpoolBoard', () => {
    let result: ReturnType<typeof useCarpoolBoard>
    const expose = (r: typeof result) => { result = r }
    function Probe({ id }: { id: string }) {
      const r = useCarpoolBoard('game', id)
      useEffect(() => { expose(r) })
      return null
    }

    it('shows no other activity\'s rides, whose buttons would act on them', async () => {
      h.kscwApi.mockResolvedValueOnce({ entries: [{ id: 'ride-1' }] })
      await mount(<Probe id="1" />)
      expect(result.data).toBeDefined()

      const two = deferred<unknown>()
      h.kscwApi.mockReturnValueOnce(two.promise)
      await mount(<Probe id="2" />)
      expect(result.data).toBeUndefined()
      expect(result.isLoading).toBe(true)
      await settle(() => two.resolve({ entries: [] }))
    })
  })

  describe('useEntryDocuments', () => {
    let result: ReturnType<typeof useEntryDocuments>
    const expose = (r: typeof result) => { result = r }
    function Probe({ id }: { id: number }) {
      const r = useEntryDocuments(id)
      useEffect(() => { expose(r) })
      return null
    }

    it('offers no other entry\'s receipts to delete', async () => {
      h.kscwApi.mockResolvedValueOnce({ documents: [{ id: 'receipt-1' }] })
      await mount(<Probe id={1} />)
      expect(result.data).toHaveLength(1)

      const two = deferred<unknown>()
      h.kscwApi.mockReturnValueOnce(two.promise)
      await mount(<Probe id={2} />)
      expect(result.data).toBeUndefined()
      expect(result.isLoading).toBe(true)
      await settle(() => two.resolve({ documents: [] }))
    })
  })
})
