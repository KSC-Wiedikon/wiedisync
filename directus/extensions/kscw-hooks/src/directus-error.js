/**
 * A DirectusError-shaped 403. Directus's error handler recognises errors by
 * `name === 'DirectusError'` (isDirectusError in @directus/errors), so this is
 * answered as a clean 403 FORBIDDEN rather than a 500 — without importing
 * @directus/errors, which this unbundled extension cannot resolve reliably.
 * (Audit 2026-09-28, F-27: a failed captcha on a public create used to surface
 * as an opaque 500.)
 */
export function forbiddenError(message = "You don't have permission to access this.") {
  const err = new Error(message)
  err.name = 'DirectusError'
  err.code = 'FORBIDDEN'
  err.status = 403
  err.extensions = {}
  return err
}
