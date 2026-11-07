import { describe, it, expect, vi, afterEach } from 'vitest'

describe('unit tests have no real network', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it.each([
    ['a string', () => 'https://directus.kscw.ch/kscw/client-error'],
    ['a URL', () => new URL('https://directus-dev.kscw.ch/items/members')],
    ['a Request', () => new Request('https://example.com/x')],
  ])('refuses %s pointing off this machine', async (_name, input) => {
    await expect(fetch(input(), { method: 'POST' })).rejects.toThrow(/A unit test tried to reach https:/)
  })

  it('lets a call to this machine through, to a server the test started itself', async () => {
    // Nothing listens on port 1, so it fails as a refused connection, not at the guard.
    for (const host of ['127.0.0.1', 'localhost']) {
      const refused = await fetch(`http://${host}:1/`).catch((e: Error) => e.message)
      expect(refused).not.toMatch(/A unit test tried to reach/)
    }
  })

  it('lets a test stub fetch, and comes back when the stub goes', async () => {
    const stub = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', stub)
    expect((await fetch('https://directus.kscw.ch/x')).status).toBe(204)
    expect(stub).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
    await expect(fetch('https://directus.kscw.ch/x')).rejects.toThrow(/A unit test tried to reach/)
  })
})
