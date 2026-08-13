/**
 * "Is this error a dead session?" — a pure predicate, deliberately in its own module.
 *
 * Split out of `lib/api.ts` so it can be unit-tested without pulling in the Directus
 * SDK, sonner and i18n (every existing test that touches lib/api has to `vi.mock` the
 * whole module). This distinction is safety-critical enough to want direct coverage:
 * getting it wrong logs members out of a live tool.
 */

/**
 * True ONLY for "your session is no longer valid" — an explicit 401, or the two
 * Directus error codes that mean the same thing.
 *
 * ⚠ Deliberately NARROWER than `isAccessDenied()` in lib/api.ts, which also matches
 * 403. Three reasons a 403 must not count:
 *
 *   - A Cloudflare WAF block surfaces as a 403. AuthProvider documents at length why
 *     tearing a session down on an ambiguous failure is wrong: it signs a member out
 *     over a blip, and the reload re-fires the ~350-request boot, which is exactly
 *     what turns a transient block into a sustained one.
 *   - 403 legitimately means "you may not read this collection", which says nothing
 *     about whether the session is alive.
 *   - Directus also answers 403 during the token-refresh race that `isPermissionError`
 *     exists to absorb.
 */
export function isSessionExpired(err: unknown): boolean {
  const e = err as {
    status?: number
    response?: { status?: number }
    errors?: Array<{ extensions?: { code?: string } } | null> | null
  } | null

  if ((e?.status ?? e?.response?.status) === 401) return true

  return (e?.errors ?? []).some(
    (x) => x?.extensions?.code === 'TOKEN_EXPIRED' || x?.extensions?.code === 'INVALID_CREDENTIALS',
  )
}
