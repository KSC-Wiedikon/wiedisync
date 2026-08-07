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
  if (typeof obj.message === 'string' && !USELESS_MESSAGES.has(obj.message.trim())) {
    return obj.message
  }
  // Surface HTTP-ish hints when present so the issue isn't opaque.
  const status = obj.status ?? obj.statusCode ?? obj.code
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

/** Codes whose message says nothing a translated generic doesn't say better. */
const OPAQUE_CODES = new Set(['INTERNAL_SERVER_ERROR', 'UNKNOWN'])

/**
 * The server's own explanation of a REFUSAL, when there is one worth showing.
 *
 * Our kscw-hooks guards deny with a specific, actionable sentence ("You can
 * only remove members from teams you coach or are responsible for") carried in
 * a Directus error alongside a code like NOT_OWNER / NOT_TEAM_LEADER. Callers
 * that blanket-catch into a translated `errorSaving` toast throw that sentence
 * away and leave the user guessing why a button did nothing.
 *
 * Returns null — i.e. "use your own translated fallback" — for anything that
 * isn't a deliberate, explainable rejection: network failures, and the
 * INTERNAL_SERVER_ERROR fallback whose message is the opaque "An unexpected
 * error occurred." Those say nothing a translated generic doesn't say better.
 *
 * ⚠ The messages are server-side English and are NOT translated. That is the
 * accepted trade: a precise English reason beats a localized dead end. Anything
 * a member (rather than staff) hits routinely deserves a real i18n key instead.
 */
export function serverDenialMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const errors = (error as { errors?: unknown }).errors
    ?? ((error as { cause?: { errors?: unknown } }).cause?.errors)
  if (!Array.isArray(errors) || errors.length === 0) return null
  const first = errors[0] as { message?: unknown; extensions?: { code?: unknown } } | undefined
  const code = first?.extensions?.code
  if (typeof code !== 'string' || OPAQUE_CODES.has(code)) return null
  const message = first?.message
  if (typeof message !== 'string' || !message.trim()) return null
  return message.trim()
}
