/**
 * Normalize any thrown value into a real Error with an actionable message.
 *
 * The Directus SDK throws `{ errors: [{ message, extensions: { code } }] }`,
 * raw fetch failures throw `TypeError`, and some layers throw plain objects
 * or `Error`s whose `.message` is already `"[object Object]"`. The naive
 * `String(err)` / pass-through-Error path produced unactionable
 * `"[object Object]"` Sentry issues (WIEDISYNC-3T, and the regressed
 * `<object>.update /trainings` issue). This helper:
 *
 *  - extracts the Directus / generic `message` even when the value arrived
 *    wrapped as an Error with a useless message,
 *  - falls back to a circular-safe summary of own enumerable props (never
 *    a bare "[object Object]"),
 *  - always attaches the original value as `.cause` so Sentry can serialize
 *    the full payload (status, extensions, etc.).
 */

const USELESS_MESSAGES = new Set(['', '[object Object]', 'undefined', 'null'])

function withCause(message: string, original: unknown): Error {
  const e = new Error(message) as Error & { cause?: unknown }
  e.cause = original
  return e
}

/** Pull a usable string message out of an arbitrary object shape. */
function extractMessage(obj: Record<string, unknown>): string | null {
  const directusErrors = obj.errors
  if (Array.isArray(directusErrors) && directusErrors.length > 0) {
    const first = directusErrors[0] as Record<string, unknown> | undefined
    if (first && typeof first.message === 'string' && first.message.trim()) {
      return first.message
    }
  }
  // The SDK's RequestError has an empty message when reading the response body failed,
  // and the real error sits in `errors`. A connection that dies mid-response is a
  // TypeError "Failed to fetch" there, with status 200. Serialized, an Error is `{}`,
  // which turned ordinary network drops into unreadable api_error entries.
  if (directusErrors instanceof Error && !USELESS_MESSAGES.has(directusErrors.message.trim())) {
    return directusErrors.message
  }
  if (typeof obj.message === 'string' && !USELESS_MESSAGES.has(obj.message.trim())) {
    return obj.message
  }
  // Surface HTTP-ish hints when present so the issue isn't opaque. RequestError keeps
  // its status on the Response, which also serializes to `{}`.
  const response = obj.response as { status?: unknown } | null | undefined
  const status = obj.status ?? obj.statusCode ?? obj.code ?? response?.status
  if (status != null) {
    const op = typeof obj.operation === 'string' ? ` (${obj.operation})` : ''
    return `Request failed with status ${String(status)}${op}`
  }
  try {
    const json = JSON.stringify(obj)
    if (json && json !== '{}') return json.slice(0, 500)
  } catch {
    /* circular — fall through */
  }
  const keys = Object.keys(obj)
  if (keys.length > 0) return `Non-serializable error { ${keys.slice(0, 10).join(', ')} }`
  return null
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    const msg = (error.message ?? '').trim()
    if (!USELESS_MESSAGES.has(msg)) return error
    // Error instance but the message is useless — try to recover a real one
    // from its own props or its cause, while keeping the original as cause.
    const fromSelf = extractMessage(error as unknown as Record<string, unknown>)
    if (fromSelf) return withCause(fromSelf, error)
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause && typeof cause === 'object') {
      const fromCause = extractMessage(cause as Record<string, unknown>)
      if (fromCause) return withCause(fromCause, error)
    }
    return withCause(`${error.name || 'Error'} (no message)`, error)
  }

  if (typeof error === 'string') return new Error(error)

  if (error && typeof error === 'object') {
    const extracted = extractMessage(error as Record<string, unknown>)
    if (extracted) return withCause(extracted, error)
  }

  return new Error(String(error))
}
