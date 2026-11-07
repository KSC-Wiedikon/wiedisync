/**
 * Unit tests never reach the outside world. Loaded for every test by vitest.config.ts.
 *
 * Errors are reported for real by `sendToErrorLog`, and it picks the backend from the
 * page's hostname. So a test that claims to run on wiedisync.kscw.ch and doesn't stub
 * `fetch` posts its fake failures to the LIVE error log, which happened on 2026-11-06.
 *
 * A test's own stub replaces this one as usual (`vi.stubGlobal('fetch', …)`) and
 * `vi.unstubAllGlobals()` brings it back. A server the test started itself on this
 * machine stays reachable.
 */
const realFetch = globalThis.fetch
const THIS_MACHINE = new Set(['localhost', '127.0.0.1', '[::1]'])

function hostOf(input: RequestInfo | URL): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // A relative URL has no host of its own, so it can't reach anything off this machine.
  return new URL(raw, 'http://localhost')
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = hostOf(input)
  if (THIS_MACHINE.has(url.hostname)) return realFetch(input, init)
  throw new TypeError(`A unit test tried to reach ${url.origin}${url.pathname}. Stub fetch in this test.`)
}
