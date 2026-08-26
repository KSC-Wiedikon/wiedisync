import { describe, it, expect, vi } from 'vitest'

// ⚠ vi.hoisted, not a factory closing over an outer `vi.fn()` — vi.mock factories
// are hoisted above the file's own declarations.
const api = vi.hoisted(() => ({ kscwApi: vi.fn() }))
vi.mock('../../../../lib/api', () => api)

const { detectClubdeskConflicts } = await import('../clubdeskConflicts')

/** The error shape kscwApi throws: message + status (+ optional code/body). */
const apiError = (status: number) =>
  Object.assign(new Error(`API /clubdesk-sync/proposals/detect: ${status}`), { status })

/**
 * ⚠ Do NOT rewrite these as `await expect(fn()).rejects.toThrow()`. On this
 * repo's vitest (4.1.10), a mocked module function that rejects fails the test
 * outright — the rejection is reported as an error in the test regardless of
 * `.rejects`, `mockRejectedValue` or `mockImplementation(async () => throw)`.
 * Catching it here is not a weaker assertion: it pins down the same two facts,
 * whether the call returned and with what, or threw and carrying which status.
 */
async function outcome(): Promise<{ value: unknown } | { threwStatus?: number }> {
  try {
    return { value: await detectClubdeskConflicts() }
  } catch (e) {
    return { threwStatus: (e as { status?: number })?.status }
  }
}

/**
 * ⚠ No `beforeEach(() => api.kscwApi.mockReset())`. On vitest 4.1.10 that reset
 * makes every error a later `mockImplementation` throws surface as an unhandled
 * error in the test — three green assertions reported as three failures, with no
 * assertion diff to explain them. Each test below sets the mock's behaviour
 * completely, so there is nothing to reset; none of them assert on call counts.
 */
describe('detectClubdeskConflicts', () => {
  it('returns the staged count', async () => {
    api.kscwApi.mockResolvedValue({ staged: 3, considered: 3, capped: false, cap: 150 })
    expect(await outcome()).toEqual({ value: { staged: 3, considered: 3, capped: false, cap: 150 } })
  })

  it('reports 0 when the endpoint answers but stages nothing', async () => {
    api.kscwApi.mockResolvedValue({ staged: 0, considered: 0, capped: false, cap: 150 })
    expect(await outcome()).toEqual({ value: { staged: 0, considered: 0, capped: false, cap: 150 } })
  })

  it('carries `capped` through — staged 0 there means the OPPOSITE of "nothing to decide"', async () => {
    // The runaway guard refuses to stage when the inputs are clearly wrong (a
    // stale or half-loaded clubdesk_export makes hundreds of members disagree at
    // once — dev stages 698 email conflicts purely from its PII scrub). The flag
    // has to survive the boundary, or the caller reports the loudest data fault
    // as the quietest all-clear.
    api.kscwApi.mockResolvedValue({ staged: 0, considered: 700, capped: true, cap: 150 })
    expect(await outcome()).toEqual({ value: { staged: 0, considered: 700, capped: true, cap: 150 } })
  })

  it('defaults a missing capped flag to false rather than undefined', async () => {
    api.kscwApi.mockResolvedValue({ staged: 2 })
    expect(await outcome()).toEqual({ value: { staged: 2, considered: 0, capped: false, cap: 0 } })
  })

  it('treats a 404 as the deploy window and returns null, NOT 0', async () => {
    // Cloudflare Pages ships this page on push while ext:deploy is run by hand,
    // so the frontend can briefly ask for a route the endpoint does not have.
    // null lets the caller stay silent; 0 would be a claim ("nothing to stage")
    // that is not true — the scheduled hook stages them within 15 minutes.
    api.kscwApi.mockImplementation(async () => { throw apiError(404) })
    expect(await outcome()).toEqual({ value: null })
  })

  it('still throws on a real failure — 500 is not a deploy window', async () => {
    // The 404 branch must stay narrow. Swallowing a 500 would make a broken
    // staging endpoint look exactly like a healthy one with nothing to do.
    api.kscwApi.mockImplementation(async () => { throw apiError(500) })
    expect(await outcome()).toEqual({ threwStatus: 500 })
  })

  it('throws on a 403 — a gate failure must be visible, not silent', async () => {
    api.kscwApi.mockImplementation(async () => { throw apiError(403) })
    expect(await outcome()).toEqual({ threwStatus: 403 })
  })
})
