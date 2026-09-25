/**
 * Pure helpers for the household acting-member transport (migration 348).
 *
 * Split out of `lib/api.ts` so the decisions that keep a request on the right
 * identity can be unit-tested without the SDK, sonner or i18n. api.ts owns the
 * state (`_actingMemberId`) and the side effects; this file only decides.
 */

export const ACTING_HEADER = 'X-KSCW-Acting-Member'
export const ACTING_DENIED_CODE = 'KSCW_ACTING_DENIED'
export const ACTING_PATH_DENIED_MESSAGE = 'Not available while using another account'

/** A positive integer member id, or null for anything else. */
export function parseActingId(raw: string | null | undefined): number | null {
  const n = raw == null || raw === '' ? NaN : Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** The acting id a request was actually SENT with, read from its headers. */
export function sentActingId(headers: HeadersInit | undefined): number | null {
  if (!headers) return null
  let raw: string | null | undefined
  if (headers instanceof Headers) raw = headers.get(ACTING_HEADER)
  else if (Array.isArray(headers)) raw = headers.find(([k]) => k.toLowerCase() === ACTING_HEADER.toLowerCase())?.[1]
  else raw = (headers as Record<string, string>)[ACTING_HEADER]
  return parseActingId(raw)
}

/** True for an error (kscwApi or SDK) the acting middleware produced. */
export function isActingDeniedError(err: unknown): boolean {
  const e = err as { code?: string; errors?: unknown; data?: unknown } | null
  if (!e) return false
  if (e.code === ACTING_DENIED_CODE) return true
  const errors = e.errors as { code?: string } | Array<{ extensions?: { code?: string } }> | undefined
  if (errors && !Array.isArray(errors) && errors.code === ACTING_DENIED_CODE) return true
  const data = e.data as { code?: string } | undefined
  return data?.code === ACTING_DENIED_CODE
}

/**
 * Which kind of refusal the server sent under KSCW_ACTING_DENIED:
 *   'path'  — this one route is never available while acting; the acting state is fine.
 *   'grant' — this login may not act for that member (any more); drop back to self.
 */
export function actingRefusalScope(body: { error?: string; scope?: string } | null | undefined): 'path' | 'grant' {
  return body?.scope === 'path' || body?.error === ACTING_PATH_DENIED_MESSAGE ? 'path' : 'grant'
}

/**
 * Does the server's echoed identity disagree with the one this request was SENT
 * as? Only a 2xx carries an echo by construction.
 *
 * ⚠ Compared against `sentId`, never the app's CURRENT acting id: a response
 * still in flight when the parent switched carries the old identity's echo, and
 * that is not a desync — its query was already dropped by queryClient.clear().
 */
export function isActingEchoMismatch(ok: boolean, echoed: string | null, sentId: number | null): boolean {
  if (!ok) return false
  const expected = sentId == null ? null : String(sentId)
  return echoed !== expected
}
