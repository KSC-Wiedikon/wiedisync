// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://wiedisync-dev.kscw.ch/"}
//
// What the Directus SDK throws when a request goes wrong, read through the real SDK so
// a future version that changes the shape fails here. A connection dying mid-response
// reaches the app as a RequestError with an empty message and a TypeError inside, and
// used to be logged as an unreadable api_error: {"name":"RequestError","response":{},"errors":{}}.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDirectus, readItems, rest } from '@directus/sdk'

const { deliverErrorReport } = vi.hoisted(() => ({ deliverErrorReport: vi.fn() }))
vi.mock('./errorLogQueue', () => ({ deliverErrorReport }))

import { captureApiError } from './sentry'
import { toError } from '../utils/toError'

const JSON_TYPE = { 'content-type': 'application/json' }

/** Rejects with whatever the fake server's answer makes the real SDK throw. */
async function thrownBy(answer: () => Response | Promise<Response>): Promise<unknown> {
  try {
    const fakeFetch = (async () => answer()) as typeof fetch
    await createDirectus('https://directus.example', { globals: { fetch: fakeFetch } }).with(rest()).request(readItems('x' as never))
  } catch (err) {
    return err
  }
  throw new Error('The SDK did not throw')
}

// What real Chromium does when the socket dies after good headers: `fetch` resolves with
// a 200, then reading the body rejects with this TypeError (checked 2026-11-07 against a
// local server that drops the connection). happy-dom's own Response words it differently.
const cutOffMidResponse = () => ({
  ok: true,
  status: 200,
  headers: new Headers(JSON_TYPE),
  json: () => Promise.reject(new TypeError('Failed to fetch')),
  text: () => Promise.reject(new TypeError('Failed to fetch')),
}) as unknown as Response

function report() {
  expect(deliverErrorReport).toHaveBeenCalledTimes(1)
  return deliverErrorReport.mock.calls[0][0] as { event: string; level: string; error: string }
}

describe('errors from the Directus SDK', () => {
  beforeEach(() => { deliverErrorReport.mockClear() })

  it('logs a connection dying mid-response as the network drop it is', async () => {
    const err = await thrownBy(cutOffMidResponse)
    expect(toError(err).message).toBe('Failed to fetch')

    captureApiError(err, { operation: 'fetchItems', collection: 'games' })
    expect(report()).toMatchObject({ event: 'network_error', level: 'warn', error: 'Failed to fetch' })
  })

  it('keeps a response that really is broken as an api_error, and says what broke', async () => {
    const err = await thrownBy(() => new Response('{"data":[{"id":', { status: 200, headers: JSON_TYPE }))
    captureApiError(err, { operation: 'fetchItems', collection: 'games' })
    const logged = report()
    expect(logged.event).toBe('api_error')
    expect(logged.error).toMatch(/JSON/)
    expect(logged.error).not.toContain('RequestError')
  })

  it('names the status of an error page, instead of serializing the whole thing', async () => {
    const err = await thrownBy(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
    expect(toError(err).message).toBe('Request failed with status 502')

    captureApiError(err, { operation: 'fetchItems', collection: 'games' })
    expect(report()).toMatchObject({ event: 'api_error', error: 'Request failed with status 502' })
  })

  it('still reads a normal Directus error', async () => {
    const err = await thrownBy(() => new Response(
      JSON.stringify({ errors: [{ message: 'You don\'t have permission to access this.', extensions: { code: 'FORBIDDEN' } }] }),
      { status: 403, headers: JSON_TYPE },
    ))
    expect(toError(err).message).toBe('You don\'t have permission to access this.')
  })

  it('still reads a request that never got a response', async () => {
    const err = await thrownBy(() => Promise.reject(new TypeError('Failed to fetch')))
    captureApiError(err, { operation: 'fetchItems', collection: 'games' })
    expect(report()).toMatchObject({ event: 'network_error', error: 'Failed to fetch' })
  })
})
