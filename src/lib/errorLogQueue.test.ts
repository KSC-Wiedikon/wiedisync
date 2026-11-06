// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://wiedisync.kscw.ch/"}
//
// The error-report queue (lib/errorLogQueue.ts): what is kept when the collector can't
// be reached, what is not, how it goes out later and who it can go out under. No test
// here reaches the network: fetch is stubbed before anything is sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./e2eeStore', () => ({ clearAllCachedDocuments: vi.fn(async () => {}) }))

import { clearErrorLogQueue, deliverErrorReport, flushErrorLogQueue, startErrorLogQueue } from './errorLogQueue'
import { logout, refreshAuth } from './api'
import { captureApiError, sendToErrorLog } from './sentry'

const KEY = 'kscw-error-log-queue'
type Entry = Record<string, unknown> & { error?: string; event?: string; payload?: Record<string, unknown> }

const stored = (): Entry[] => JSON.parse(localStorage.getItem(KEY) ?? '[]')
const errors = (entries: Entry[]) => entries.map((e) => e.error?.split(' — ')[0])
const report = (n = 1, extra: Record<string, unknown> = {}) => ({ event: 'api_error', error: `boom ${n}`, ...extra })
const networkError = (n: number) => report(n, { event: 'network_error', level: 'warn' })

type FetchMock = ReturnType<typeof vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

/** Answers in order, the last one repeating. 'reject' is a fetch that got no answer. */
function answer(...answers: Array<number | 'reject'>): FetchMock {
  const mock: FetchMock = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift()! : answers[0]
    if (next === 'reject') throw new TypeError('Failed to fetch')
    return new Response(null, { status: next })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** A fetch that waits until told how to end. */
function held() {
  const ends: Array<{ deliver: () => void; fail: () => void }> = []
  const mock: FetchMock = vi.fn(() => new Promise<Response>((resolve, reject) => {
    ends.push({
      deliver: () => resolve(new Response(null, { status: 204 })),
      fail: () => reject(new TypeError('Failed to fetch')),
    })
  }))
  vi.stubGlobal('fetch', mock)
  return { mock, ends }
}

const bodies = (mock: FetchMock): Entry[] => mock.mock.calls.map(([, init]) => JSON.parse(init?.body as string))

async function queueUp(...reports: Array<Record<string, unknown>>) {
  answer('reject')
  for (const r of reports) await deliverErrorReport(r)
}

function spyOnConsole() {
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  }
}

// One day per test: the flush budget lives in the module, and a test may move the clock
// on by a few hours but never past the next test's start.
let clock = Date.parse('2026-11-06T10:00:00.000Z')
beforeEach(() => {
  clock += 86_400_000
  vi.setSystemTime(clock)
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('delivery', () => {
  it('queues a report when the fetch rejects', async () => {
    const mock = answer('reject')
    await deliverErrorReport(report())
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls[0][0]).toBe('https://directus.kscw.ch/kscw/client-error')
    expect(errors(stored())).toEqual(['boom 1'])
  })

  it.each([500, 502, 503, 530])('queues a report answered with a %i', async (status) => {
    answer(status)
    await deliverErrorReport(report())
    expect(errors(stored())).toEqual(['boom 1'])
  })

  it.each([400, 401, 403, 413, 429])('neither keeps nor retries a report refused with a %i, and does not flush', async (status) => {
    await queueUp(report(1))
    const mock = answer(status)
    await deliverErrorReport(report(2))
    expect(mock).toHaveBeenCalledTimes(1)
    expect(errors(stored())).toEqual(['boom 1'])
  })

  it('sends the report as it is, and stores nothing, when delivery works', async () => {
    const mock = answer(204)
    await deliverErrorReport(report(1, { payload: { collection: 'games' } }))
    expect(bodies(mock)).toEqual([report(1, { payload: { collection: 'games' } })])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('flushes the queue after a delivered report', async () => {
    await queueUp(report(1), report(2))
    const mock = answer(204)
    await deliverErrorReport(report(3))
    expect(errors(bodies(mock))).toEqual(['boom 3', 'boom 1', 'boom 2'])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('gives up on a request that never settles, and queues the report', async () => {
    vi.useFakeTimers({ now: clock })
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const sending = deliverErrorReport(report())
    await vi.advanceTimersByTimeAsync(15_000)
    await sending
    expect(errors(stored())).toEqual(['boom 1'])
  })
})

describe('caps', () => {
  it('keeps the newest 20, in order', async () => {
    await queueUp(...Array.from({ length: 25 }, (_, i) => report(i + 1)))
    expect(errors(stored())).toEqual(Array.from({ length: 20 }, (_, i) => `boom ${i + 6}`))
  })

  it('keeps one huge report small', async () => {
    const huge = 'x'.repeat(200_000)
    await queueUp(report(1, {
      error: huge, stack: huge, responseBody: huge, page: huge, endpoint: huge, userAgent: huge, payload: { rows: huge },
    }))
    expect(localStorage.getItem(KEY)!.length).toBeLessThan(10_000)
    expect(stored()[0].stack).toHaveLength(2000)
    expect(stored()[0].responseBody).toHaveLength(1000)
  })

  it('lets a burst of network errors take three places and push out nothing else', async () => {
    const others = Array.from({ length: 20 }, (_, i) => report(i + 1))
    const burst = Array.from({ length: 50 }, (_, i) => networkError(i + 100))
    await queueUp(...others, ...burst)
    const queue = stored()
    expect(errors(queue.filter((e) => e.event === 'api_error'))).toEqual(errors(others))
    expect(errors(queue.filter((e) => e.event === 'network_error'))).toEqual(['boom 147', 'boom 148', 'boom 149'])
  })
})

describe('deferred marking', () => {
  it('keeps the original time, in the same way as boot-watchdog', async () => {
    const at = new Date(clock).toISOString()
    await queueUp(report(1, { level: 'warn', status: 502, page: '/games', payload: { collection: 'games', at: 'not this one' } }))
    vi.setSystemTime(clock + 3 * 3_600_000)
    const mock = answer(204)
    await flushErrorLogQueue()
    const [body] = bodies(mock)
    expect(body.error).toBe(`boom 1 — deferred from ${at}`)
    expect(body.payload).toEqual({ deferred: true, at, data: { collection: 'games', at: 'not this one' } })
    expect(body).toMatchObject({ event: 'api_error', level: 'warn', status: 502, page: '/games' })
  })

  it('takes the time of the report, not of the moment the request gave up', async () => {
    const { ends } = held()
    const at = new Date(clock).toISOString()
    const sending = deliverErrorReport(report())
    vi.setSystemTime(clock + 60_000)
    ends[0].fail()
    await sending
    expect(stored()[0].payload?.at).toBe(at)
  })

  it('survives what the collector cuts: error at 1000 characters, the payload string at 500', async () => {
    const at = new Date(clock).toISOString()
    await queueUp(report(1, { error: 'x'.repeat(5000), payload: { rows: 'y"'.repeat(5000) } }))
    const mock = answer(204)
    await flushErrorLogQueue()
    const [body] = bodies(mock)
    expect(body.error!.length).toBeLessThanOrEqual(1000)
    expect(body.error!.endsWith(` — deferred from ${at}`)).toBe(true)
    expect(JSON.stringify(body.payload).slice(0, 500)).toContain(`{"deferred":true,"at":"${at}"`)
  })

  it('still marks a report that has no error text of its own', async () => {
    const at = new Date(clock).toISOString()
    await queueUp({ event: 'unhandled_error', type: 'TypeError' })
    expect(stored()[0].error).toBe(` — deferred from ${at}`)
  })
})

describe('flush', () => {
  it('sends at most five, one at a time and oldest first, and stays within the budget', async () => {
    await queueUp(...Array.from({ length: 8 }, (_, i) => report(i + 1)))
    let inFlight = 0
    let most = 0
    const mock: FetchMock = vi.fn(async () => {
      most = Math.max(most, ++inFlight)
      await new Promise((resolve) => setTimeout(resolve))
      inFlight--
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', mock)

    await flushErrorLogQueue()
    expect(errors(bodies(mock))).toEqual(['boom 1', 'boom 2', 'boom 3', 'boom 4', 'boom 5'])
    expect(most).toBe(1)
    expect(errors(stored())).toEqual(['boom 6', 'boom 7', 'boom 8'])

    await flushErrorLogQueue()
    expect(mock).toHaveBeenCalledTimes(5)

    vi.setSystemTime(clock + 60_000)
    await flushErrorLogQueue()
    expect(mock).toHaveBeenCalledTimes(8)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('cannot be pushed past the budget by a burst of delivered reports', async () => {
    await queueUp(...Array.from({ length: 20 }, (_, i) => report(i + 1)))
    const mock = answer(204)
    for (let i = 0; i < 10; i++) await deliverErrorReport(report(i + 100))
    expect(mock).toHaveBeenCalledTimes(10 + 5)
    expect(stored()).toHaveLength(15)
  })

  it.each(['reject', 503] as const)('stops at a failure (%s), leaves the entries and creates no new report', async (failure) => {
    const log = spyOnConsole()
    await queueUp(report(1), report(2), report(3))
    const before = localStorage.getItem(KEY)
    const mock = answer(failure)

    await flushErrorLogQueue()

    expect(mock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).toBe(before)
    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()

    // A failure spends no budget, and the entry is not marked a second time.
    const retry = answer(204)
    await flushErrorLogQueue()
    expect(errors(bodies(retry))).toEqual(['boom 1', 'boom 2', 'boom 3'])
    expect(bodies(retry)[0].error!.match(/deferred from/g)).toHaveLength(1)
  })

  it('still flushes after a phone has been dropping off again and again', async () => {
    await queueUp(report(1))
    answer('reject')
    for (let i = 0; i < 8; i++) await flushErrorLogQueue()
    const mock = answer(204)
    await flushErrorLogQueue()
    expect(mock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('drops an entry the collector refuses and carries on, so it cannot block the queue', async () => {
    await queueUp(report(1), report(2))
    const mock = answer(413, 204)
    await flushErrorLogQueue()
    expect(mock).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('stops at a 429, and that entry keeps its place for the next flush', async () => {
    await queueUp(report(1), report(2), report(3))
    const mock = answer(429)
    await flushErrorLogQueue()
    expect(mock).toHaveBeenCalledTimes(1)
    expect(errors(stored())).toEqual(['boom 1', 'boom 2', 'boom 3'])
  })

  it('runs one flush at a time', async () => {
    await queueUp(report(1), report(2))
    const { mock, ends } = held()
    const first = flushErrorLogQueue()
    await flushErrorLogQueue()
    expect(mock).toHaveBeenCalledTimes(1)
    ends[0].deliver()
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(2))
    ends[1].deliver()
    await first
    expect(errors(bodies(mock))).toEqual(['boom 1', 'boom 2'])
  })

  it('does not let a second tab deliver what the first is sending, and puts it back on failure', async () => {
    await queueUp(report(1))
    vi.resetModules()
    const secondTab = await import('./errorLogQueue')
    const { mock, ends } = held()

    const firstTab = flushErrorLogQueue()
    expect(localStorage.getItem(KEY)).toBeNull()
    await secondTab.flushErrorLogQueue()
    expect(mock).toHaveBeenCalledTimes(1)

    ends[0].fail()
    await firstTab
    expect(errors(stored())).toEqual(['boom 1'])
  })
})

describe('triggers', () => {
  // The only test that starts the queue: its `online` listener stays for the whole file.
  it('flushes once after the app starts and again when the browser comes online', async () => {
    await queueUp(report(1))
    vi.useFakeTimers({ now: clock })
    const atStart = answer(204)
    const listen = vi.spyOn(window, 'addEventListener')
    startErrorLogQueue()
    startErrorLogQueue()
    expect(listen.mock.calls.filter(([type]) => type === 'online')).toHaveLength(1)
    expect(atStart).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(atStart).toHaveBeenCalledTimes(1)

    await queueUp(report(2))
    const whenOnline = answer(204)
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(errors(bodies(whenOnline))).toEqual(['boom 2'])
  })
})

describe('sign-out', () => {
  it('logout() clears the queue', async () => {
    await queueUp(report(1))
    const mock = answer(204)
    await logout()
    expect(localStorage.getItem(KEY)).toBeNull()
    // The SDK's logout went to the stub too, and no queued report went out.
    expect(String(mock.mock.calls[0][0])).toContain('/auth/logout')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('logout() clears at once, and again for what failed while the session was ending', async () => {
    await queueUp(report(1))
    let finish = () => {}
    vi.stubGlobal('fetch', vi.fn((url: string) => (url.includes('/client-error')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : new Promise((resolve) => { finish = () => resolve(new Response(null, { status: 204 })) }))))
    const signingOut = logout()
    expect(localStorage.getItem(KEY)).toBeNull() // the awaits in logout() can hang
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    await deliverErrorReport(report(2))
    expect(errors(stored())).toEqual(['boom 2'])
    finish()
    await signingOut
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('a rejected refresh ends the session, so it clears the queue', async () => {
    spyOnConsole()
    await queueUp(report(1))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ errors: [{ message: 'Invalid token', extensions: { code: 'INVALID_TOKEN' } }] }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )))
    await expect(refreshAuth()).rejects.toBeDefined()
    await vi.waitFor(() => expect(localStorage.getItem(KEY)).toBeNull())
  })

  it('a refresh that hits a restarting Directus keeps the queue: that is when it matters', async () => {
    spyOnConsole()
    await queueUp(report(1))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502, headers: { 'Content-Type': 'text/html' } })))
    await expect(refreshAuth()).rejects.toBeDefined()
    expect(errors(stored())[0]).toBe('boom 1')
  })

  it('does not bring back a report that was under way when the queue was cleared', async () => {
    const { ends } = held()
    const sending = deliverErrorReport(report(1))
    clearErrorLogQueue()
    ends[0].fail()
    await sending
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it.each(['fail', 'deliver'] as const)('ends a flush under way when the queue is cleared (%s), and puts nothing back', async (end) => {
    await queueUp(report(1))
    const { mock, ends } = held()
    const flushing = flushErrorLogQueue()
    clearErrorLogQueue()
    await queueUp(report(2)) // the next person's, which the old flush must leave alone
    vi.stubGlobal('fetch', mock)
    ends[0][end]()
    await flushing
    expect(mock).toHaveBeenCalledTimes(1)
    expect(errors(stored())).toEqual(['boom 2'])
  })
})

describe('storage trouble', () => {
  it('never throws when every localStorage access throws', async () => {
    vi.stubGlobal('localStorage', new Proxy({}, { get() { throw new Error('Denied') } }))
    const log = spyOnConsole()
    answer('reject')
    await expect(deliverErrorReport(report())).resolves.toBeUndefined()
    await expect(flushErrorLogQueue()).resolves.toBeUndefined()
    expect(() => clearErrorLogQueue()).not.toThrow()
    answer(204)
    await expect(deliverErrorReport(report())).resolves.toBeUndefined()
    expect(log.error).not.toHaveBeenCalled()
  })

  it('never throws when the localStorage accessor itself throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Denied') } })
    try {
      answer('reject')
      await expect(deliverErrorReport(report())).resolves.toBeUndefined()
      await expect(flushErrorLogQueue()).resolves.toBeUndefined()
      expect(() => clearErrorLogQueue()).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })

  it('does not send an entry it cannot take out of storage, or it would go out on every flush', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify([report(1)]),
      setItem: () => { throw new Error('Quota') },
      removeItem: () => { throw new Error('Denied') },
    })
    const mock = answer(204)
    await flushErrorLogQueue()
    expect(mock).not.toHaveBeenCalled()
  })

  it.each(['{not json', '{"a":1}', '[1,null,"x"]'])('ignores what it cannot read: %s', async (garbage) => {
    localStorage.setItem(KEY, garbage)
    const mock = answer(204)
    await flushErrorLogQueue()
    expect(mock).not.toHaveBeenCalled()
  })

  it('stores a report over what it cannot read', async () => {
    localStorage.setItem(KEY, '{not json')
    await queueUp(report(1))
    expect(errors(stored())).toEqual(['boom 1'])
  })

  it('keeps the readable entries beside garbage', async () => {
    localStorage.setItem(KEY, JSON.stringify([1, null, report(1)]))
    const mock = answer(204)
    await flushErrorLogQueue()
    expect(errors(bodies(mock))).toEqual(['boom 1'])
  })

  it('survives a payload that cannot be serialised', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    answer('reject')
    await expect(deliverErrorReport(report(1, { payload: circular }))).resolves.toBeUndefined()
    expect(errors(stored())).toEqual(['boom 1'])
  })
})

describe('through sendToErrorLog', () => {
  const hexToken = 'a1b2c3d4e5f60718a9b0c1d2e3f40516' // gitleaks:allow — synthetic fixture
  const shareToken = 'Zk3_q9-LmN0pQrStUvWxYz012345AbCdEfGhIjKlMnO' // gitleaks:allow — synthetic fixture

  it('stores a report only after the token redaction has run', async () => {
    spyOnConsole()
    vi.stubGlobal('location', { hostname: 'wiedisync.kscw.ch', pathname: `/e/${shareToken}` })
    answer('reject')
    const err = new Error(`API /team-invites/info/${hexToken}: 500`)
    err.stack = `at /set-password?token=${hexToken}`
    captureApiError(err, {
      operation: 'kscwApi',
      endpoint: `/team-invites/info/${hexToken}`,
      status: 500,
      responseBody: `Failed for /team-invites/info/${hexToken}`,
    })
    await vi.waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull())
    const raw = localStorage.getItem(KEY)!
    expect(raw).not.toContain(hexToken)
    expect(raw).not.toContain(shareToken)
    expect(raw).toContain('/e/:token')
    expect(raw).toContain('/team-invites/info/:token')
  })

  it('neither sends nor queues in local dev', async () => {
    spyOnConsole()
    vi.stubGlobal('location', { hostname: 'localhost', pathname: '/' })
    const mock = answer('reject')
    captureApiError(new Error('Failed to fetch'), { operation: 'fetchItems' })
    await new Promise((resolve) => setTimeout(resolve))
    expect(mock).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('neither sends nor queues an empty entry', async () => {
    const mock = answer('reject')
    sendToErrorLog({ source: 'frontend', event: 'api_error', error: '', stack: '' })
    await new Promise((resolve) => setTimeout(resolve))
    expect(mock).not.toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
