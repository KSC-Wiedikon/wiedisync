/**
 * The machine-readable code on a failed API call, whichever path made it.
 *
 *  - Directus SDK (`createRecord` / `updateRecord` / …): the thrown value is a
 *    plain object `{ errors: [{ message, extensions: { code } }], response }`.
 *    A kscw-hooks filter that throws `kscwScopeError(msg, status, CODE)` lands
 *    here as `errors[0].extensions.code === CODE`.
 *  - `kscwApi`: an `Error` carrying `code` (and `body`) copied from the JSON.
 *  - `useMutation` / `toError`: a fresh `Error` whose `.cause` is one of the
 *    above — followed a few levels deep.
 *
 * Returns undefined when there is no code — callers fall back to their generic
 * toast. Never throws.
 */
export function apiErrorCode(err: unknown, depth = 0): string | undefined {
  if (!err || typeof err !== 'object' || depth > 3) return undefined
  const e = err as {
    code?: unknown
    errors?: Array<{ extensions?: { code?: unknown } }>
    body?: { code?: unknown; errors?: Array<{ extensions?: { code?: unknown } }> }
    cause?: unknown
  }
  const fromSdk = e.errors?.[0]?.extensions?.code
  if (typeof fromSdk === 'string' && fromSdk) return fromSdk
  if (typeof e.code === 'string' && e.code) return e.code
  const fromBody = e.body?.code ?? e.body?.errors?.[0]?.extensions?.code
  if (typeof fromBody === 'string' && fromBody) return fromBody
  return apiErrorCode(e.cause, depth + 1)
}

/** True when the error carries `code` (see `apiErrorCode`). */
export function hasApiErrorCode(err: unknown, code: string): boolean {
  return apiErrorCode(err) === code
}
